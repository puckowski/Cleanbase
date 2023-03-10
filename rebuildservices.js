var https = require('https');
var url = require('url');
var fs = require('fs');
var cp = require('child_process');
const path = require('path');

const mariadb = require('mariadb');
const { DATABASE_PASSWORD } = require('./constants');
const pool = mariadb.createPool({
	host: 'localhost',
	user: 'root',
	password: DATABASE_PASSWORD,
	connectionLimit: 10,
	database: 'cleanbase'
});

async function rebuildServices() {
	try {
		fs.unlinkSync('readyservices.txt');
		// file removed
	} catch (err) {
		// console.error(err);
	}

	cp.exec('./isserviceready.sh', async (error, stdout, stderr) => {
		// catch err, stdout, stderr
		if (error) {
			console.log('Error in removing files');
			// return;
		}
		if (stderr) {
			console.log('has stderr output');
			console.log(stderr);
			// return;
		}

		const runningSet = new Set();
		const serviceNameSet = new Set();

		const allFileContents = fs.readFileSync('readyservices.txt', 'utf-8');
		allFileContents.split(/\r?\n/).forEach(line => {
			if (line.includes('/usr/disk-images/')) {
				let service = line.substring(line.indexOf('/usr/disk-images/') + 17);

				const closeParenCount = service.split(')').length - 1;

				if (service.endsWith(')') && closeParenCount === 1) {
					runningSet.add(service.substring(0, service.length - 1), true);
				}
			}
		});

		let conn;
		try {
			conn = await pool.getConnection();

			const portsToRun = await conn.query("SELECT service_port, service_endpoint, service_name from tbl_endpoint LEFT JOIN tbl_service ON tbl_service.id = service_id");

			if (portsToRun.length > 0) {
				portsToRun.forEach(portRow => {
					const toRun = portRow.service_name;

					if (!runningSet.has(toRun) && !serviceNameSet.has(portRow.service_name)) {
						serviceNameSet.add(portRow.service_name);

						cp.execSync('./rebuildservices.sh ' + portRow.service_name, (error, stdout, stderr) => {
							// catch err, stdout, stderr
							if (error) {
								console.log('Error in removing files');
								// return;
							}
							if (stderr) {
								console.log('has stderr output');
								console.log(stderr);
								// return;
							}
						});
					} else {
					}
				});

				if (conn) conn.end();

				process.exit(1);
			} else {
				if (conn) conn.end();

				process.exit(1);
			}
		} catch (err) {
			throw err;
		}
	});
}

async function run() {
	await rebuildServices();
}

run();
