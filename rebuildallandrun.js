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

let toStartCount = 0;

async function stopContainer(port) {
	if (!port || port < 3000) {
		return;
	}

	cp.execSync('./stopcontainer.sh ' + port, (error, stdout, stderr) => {
		if (error) {
			console.log('Error in removing files');
			return;
		}
		if (stderr) {
			console.log('Has stderr output');
			console.log(stderr);
		}

		return;
	});
}


async function runStoppedContainers() {
	try {
		if (fs.existsSync('runningports.txt')) {
			fs.unlinkSync('runningports.txt');
		}
	} catch (err) {
	}

	console.log('Run stopped containers after removing file');

	cp.exec('./removestopped.sh', (error, stdout, stderr) => {
		if (error) {
			console.log('Error in removing files');
		}
		if (stderr) {
			console.log('Has stderr output');
			console.log(stderr);
		}

		cp.exec('./runstopped.sh', async (error, stdout, stderr) => {
			if (error) {
				console.log('Error in removing files');
			}
			if (stderr) {
				console.log('Has stderr output');
				console.log(stderr);
			}

			const runningSet = new Set();

			const allFileContents = fs.readFileSync('runningports.txt', 'utf-8');
			allFileContents.split(/\r?\n/).forEach(line => {
				let port = line.replace(':::', '');
				port = port.replace('->', '');
				port = port.trim();

				if (port !== '') {
					runningSet.add(Number(port));
				}
			});

			let conn;
			try {
				conn = await pool.getConnection();

				const portsToRun = await conn.query("SELECT service_port, service_endpoint, service_name from tbl_endpoint LEFT JOIN tbl_service ON tbl_service.id = service_id");

				if (portsToRun.length > 0) {
					portsToRun.forEach(portRow => {
						toStartCount++;
					});

					portsToRun.forEach(portRow => {
						const toRun = portRow.service_port;

						if (!runningSet.has(toRun)) {
							cp.exec('./restartstopped.sh ' + portRow.service_name + portRow.service_endpoint + ':1.0 ' + toRun
								+ ' ' + portRow.service_name, (error, stdout, stderr) => {
									if (error) {
										console.log('Error in removing files');
									}
									if (stderr) {
										console.log('Has stderr output');
										console.log(stderr);
									}

									toStartCount--;

									if (toStartCount === 0) {
										process.exit(1);
									}
								});
						}

						return;
					});
				} else {
					process.exit(1);
				}
			} catch (err) {
				throw err;
			} finally {
				if (conn) conn.end();
			}
		});
	});
}

async function rebuildAllAndRun() {
	try {
		fs.unlinkSync('buildlist.txt');
	} catch (err) {
	}

	cp.exec('./listbuilds.sh', async (error, stdout, stderr) => {
		if (error) {
			console.log('Error in removing files');
			return;
		}
		if (stderr) {
			console.log('Has stderr output');
			console.log(stderr);
		}

		const buildSet = new Set();

		const allFileContents = fs.readFileSync('buildlist.txt', 'utf-8');
		allFileContents.split(/\r?\n/).forEach(line => {
			if (line !== '') {
				buildSet.add(line);
			}
		});

		buildSet.forEach(buildName => {
			const zipName = buildName;
			const tokens = zipName.split('_');
			const serviceSegment = tokens[0];
			const endpointSegment = tokens[1];

			cp.exec('./endpoint.sh ' + (serviceSegment + '_' + endpointSegment + '_build.zip') + ' ' + (serviceSegment + endpointSegment),
				async (error, stdout, stderr) => {
					if (error) {
						console.log('Error in removing files');
						return;
					}
					if (stderr) {
						console.log('Has stderr output');
						console.log(stderr);
					}

					let conn;
					try {
						conn = await pool.getConnection();

						const rows = await conn.query("SELECT service_port from tbl_service LEFT JOIN tbl_endpoint ON service_id = tbl_service.id where service_name = ? and service_endpoint = ?", [
							serviceSegment, endpointSegment
						]);

						let port;

						if (rows.length > 0) {
							port = rows[0].service_port;
						}

						if (!port || port < 3000) {
							return;
						}

						await stopContainer(port);
					} catch (err) {
						throw err;
					} finally {
						if (conn) conn.end();
					}
				});
		});

		await runStoppedContainers();

		return;
	});
}

async function run() {
	await rebuildAllAndRun();
	console.log('Done');
}

run();
