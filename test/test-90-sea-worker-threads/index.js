'use strict';

const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

// The worker spawns `node` with this set. If pkg rewrote the spawn to the
// packaged binary, we land here instead of in system node.
if (process.env.PKG_TEST_90_CHILD) {
  console.log('packaged-binary');
  process.exit(0);
}

// Redirect the native addon cache so the worker's dlopen check writes to a
// throwaway directory instead of the real ~/.cache. Must be set before the
// Worker is created — the worker copies process.env at spawn time and its
// bootstrap reads this while patching dlopen.
process.env.PKG_NATIVE_CACHE_PATH = path.join(
  os.tmpdir(),
  'pkg-test-90-native-cache',
);

function runWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { message: 'ping', name: 'world' },
    });

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Worker timed out'));
    }, 15000);

    worker.on('message', (msg) => {
      clearTimeout(timeout);
      resolve(msg);
      worker.terminate();
    });

    worker.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    worker.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== 1) {
        reject(new Error('Worker exited with code ' + code));
      }
    });
  });
}

async function main() {
  try {
    const result = await runWorker();
    console.log('echo:' + result.echo);
    console.log('hasFilename:' + result.hasFilename);
    console.log('hasDirname:' + result.hasDirname);
    console.log('hasProcessPkg:' + result.hasProcessPkg);
    console.log('helperResult:' + result.helperResult);
    console.log('addonExtracted:' + result.addonExtracted);
    console.log('spawnUsesExecPath:' + result.spawnUsesExecPath);
  } catch (e) {
    console.log('worker-error:' + e.message);
  }
}

main();
