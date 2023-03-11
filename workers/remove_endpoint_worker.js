const { parentPort, workerData } = require("worker_threads");
var cp = require('child_process');
var fs = require('fs');

const { endpointSegment, port, buildPath } = workerData;

try {
    fs.unlinkSync(buildPath)
} catch (err) {
}

if (!port || port < 3000) {
    return;
}

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

parentPort.postMessage({ endpointSegment, removeSegment: true });
