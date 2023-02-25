var https = require('https');
var url = require('url');
var fs = require('fs');
var cp = require('child_process');
const path = require('path');

const mariadb = require('mariadb');
const pool = mariadb.createPool({
	host: 'localhost',
	user: 'root',
	password: 'password',
	connectionLimit: 10,
	database: 'cleanbase'
});

let toStartCount = 0;

async function stopContainer(port) {
	if (!port || port < 3000) {
		return;
	}

	cp.execSync('./stopcontainer.sh ' + port, (error, stdout, stderr) => {
		// catch err, stdout, stderr
		if (error) {
			console.log('Error in removing files');
			console.log(error);
			return;
		}
		if (stderr) {
			console.log('has stderr output');
			console.log(stderr);
			// return;
		}
		console.log('Result of shell script execution', stdout);
		console.log('CONTAINER STOPPED');

		return;
	});
}


async function runStoppedContainers() {
	try {
		fs.unlinkSync('runningports.txt');
		//file removed
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

				if (portsToRun.length > 0) {
					portsToRun.forEach(portRow => {
						console.log('add port: ' + portRow.service_port + ' ' + portRow.service_name);
						toStartCount++;
					});

					portsToRun.forEach(portRow => {
						const toRun = portRow.service_port;

						if (!runningSet.has(toRun)) {
							console.log('run : ' + toRun + ' ' + portRow.service_name + portRow.service_endpoint + ':1.0');
				
							cp.exec('./restartstopped.sh ' + portRow.service_name + portRow.service_endpoint + ':1.0 ' + toRun
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

									toStartCount--;

									if (toStartCount === 0) {
										process.exit(1);
									}
								});
						}

						return;
					});
				} else {
					console.log('ports to run length: ' + portsToRun.length);
					console.log('set size: ' + runningSet.size);

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
		// file removed
	} catch (err) {
		// console.error(err);
	}

	console.log('rebuild all and run...');

	cp.exec('./listbuilds.sh', async (error, stdout, stderr) => {
		// catch err, stdout, stderr
		if (error) {
			console.log('Error in removing files');
			console.log(error);
			return;
		}
		if (stderr) {
			console.log('has stderr output');
			console.log(stderr);
			// return;
		}
		console.log('Result of shell script execution', stdout);

		console.log('parsing build set');

		const buildSet = new Set();

		const allFileContents = fs.readFileSync('buildlist.txt', 'utf-8');
		allFileContents.split(/\r?\n/).forEach(line => {
			if (line !== '') {
				buildSet.add(line);
				console.log('ADDED BUILD: ' + line);
			}
		});

		// iterate through each file path and extract them
		buildSet.forEach(buildName => {
			const zipName = buildName;
			const tokens = zipName.split('_');
			const serviceSegment = tokens[0];
			const endpointSegment = tokens[1];

			console.log('./endpoint.sh ' + (serviceSegment + '_' + endpointSegment + '_build.zip') + ' ' + (serviceSegment + endpointSegment));
			cp.exec('./endpoint.sh ' + (serviceSegment + '_' + endpointSegment + '_build.zip') + ' ' + (serviceSegment + endpointSegment),
				async (error, stdout, stderr) => {
					// catch err, stdout, stderr
					if (error) {
						console.log('Error in removing files');
						console.log(error);
						return;
					}
					if (stderr) {
						console.log('has stderr output');
						console.log(stderr);
						// return;
					}
					console.log('Result of shell script execution', stdout);
					console.log('endpoint script finished...');
					
					let conn;
					try {
						conn = await pool.getConnection();
						console.log("got connection for port stop query");

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

						console.log('try to stop port: ' + port);

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
	console.log('DONE');
}

run();
