var fs = require('fs');
var cp = require('child_process');

const mariadb = require('mariadb');
const { DATABASE_PASSWORD } = require('./constants');
const pool = mariadb.createPool({
	host: 'localhost',
	user: 'root',
	password: DATABASE_PASSWORD,
	connectionLimit: 10,
	database: 'cleanbase'
});

async function runStoppedContainers() {
	try {
		fs.unlinkSync('runningports.txt');
		// file removed
	} catch (err) {
		// console.error(err);
	}

	console.log('run stopped containers after removing file');

	cp.exec('./removestopped.sh', (error, stdout, stderr) => {
		// catch err, stdout, stderr
		if (error) {
			console.log('Error in removing files');
			console.log(error);
			// return;
		}
		if (stderr) {
			console.log('has stderr output');
			console.log(stderr);
			// return;
		}
		console.log('Result of shell script execution', stdout);

		cp.exec('./runstopped.sh', async (error, stdout, stderr) => {
			// catch err, stdout, stderr
			if (error) {
				console.log('Error in removing files');
				console.log(error);
				// return;
			}
			if (stderr) {
				console.log('has stderr output');
				console.log(stderr);
				// return;
			}
			console.log('Result of shell script execution', stdout);

			const runningSet = new Set();

			const allFileContents = fs.readFileSync('runningports.txt', 'utf-8');
			allFileContents.split(/\r?\n/).forEach(line => {
				let port = line.replace(':::', '');
				port = port.replace('->', '');
				port = port.trim();

				if (port !== '') {
					runningSet.add(Number(port));
					console.log('added port to set: ' + port);
				}
			});

			let conn;
			try {
				conn = await pool.getConnection();
				console.log("got connection");

				const portsToRun = await conn.query("SELECT service_port, service_endpoint, service_name from tbl_endpoint LEFT JOIN tbl_service ON tbl_service.id = service_id");

				if (portsToRun.length > 0 && runningSet.size < portsToRun.length) {
					portsToRun.forEach(portRow => {
						const toRun = portRow.service_port;

						if (!runningSet.has(toRun)) {
							console.log('run : ' + './restartstopped.sh ' + portRow.service_name + portRow.service_endpoint + ':1.0 ' + toRun + ' ' + portRow.service_name);

							cp.execSync('./restartstopped.sh ' + portRow.service_name + portRow.service_endpoint + ':1.0 ' + toRun
								+ ' ' + portRow.service_name, (error, stdout, stderr) => {
									// catch err, stdout, stderr
									if (error) {
										console.log('Error in removing files');
										console.log(error);
										// return;
									}
									if (stderr) {
										console.log('has stderr output');
										console.log(stderr);
										// return;
									}
									console.log('Result of shell script execution', stdout);
								});
						}
					});

					console.log('exit');

					if (conn) conn.end();

					process.exit(1);
				} else {
					console.log('ports to run length: ' + portsToRun.length);
					console.log('set size: ' + runningSet.size);

					console.log('exit');

					if (conn) conn.end();

					process.exit(1);
				}
			} catch (err) {
				throw err;
			}
		});
	});
}

async function run() {
	await runStoppedContainers();
}

run();
