const { parentPort, workerData } = require("worker_threads");
var cp = require('child_process');
var fs = require('fs');

const { endpointSegment, port, buildPath } = workerData;

try {
    fs.unlinkSync(buildPath)
    // file removed
} catch (err) {
    // console.error(err)
}

if (!port || port < 3000) {
    return;
}

cp.execSync('./stopcontainer.sh ' + port, (error, stdout, stderr) => {
    // catch err, stdout, stderr
    if (error) {
        console.log('Error in removing files');
        return;
    }
    if (stderr) {
        console.log('has stderr output');
        console.log(stderr);
        // return;
    }

    return;
});

parentPort.postMessage({ endpointSegment, removeSegment: true });
