
const { parentPort, workerData } = require("worker_threads");
var cp = require('child_process');
var fs = require('fs');
const mariadb = require('mariadb');
const { DATABASE_PASSWORD, DATABASE_HOST, DATABASE_USER, DATABASE_CONNECTION_LIMIT } = require("../constants");
const pool = mariadb.createPool({
    host: DATABASE_HOST,
    user: DATABASE_USER,
    password: DATABASE_PASSWORD,
    connectionLimit: DATABASE_CONNECTION_LIMIT,
    database: 'cleanbase'
});

const { port, endpointSegment } = workerData;

if (!port || port < 3000) {
    return;
}

parentPort.postMessage({ endpointSegment, ready: false });

cp.execSync('./scripts/stopcontainer.sh ' + port, (error, stdout, stderr) => {
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

try {
    if (fs.existsSync('runningports.txt')) {
        fs.unlinkSync('runningports.txt');
    }
} catch (err) {
    console.error(err);
}

cp.exec('./scripts/removestopped.sh', (error, stdout, stderr) => {
    if (error) {
        console.log('Error in removing files');
    }
    if (stderr) {
        console.log('Has stderr output');
        console.log(stderr);
    }

    cp.exec('./scripts/runstopped.sh', async (error, stdout, stderr) => {
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
                    const toRun = portRow.service_port;

                    if (!runningSet.has(toRun)) {
                        cp.exec('./scripts/restartstopped.sh ' + portRow.service_name + portRow.service_endpoint + ':1.0 ' + toRun
                            + ' ' + portRow.service_name, (error, stdout, stderr) => {
                                if (error) {
                                    console.log('Error in removing files');
                                }
                                if (stderr) {
                                    console.log('Has stderr output');
                                    console.log(stderr);
                                }

                                parentPort.postMessage({ endpointSegment: portRow.service_endpoint, ready: true });
                            });
                    }

                    return;
                });
            } else {
            }
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.end();
        }
    });
});
