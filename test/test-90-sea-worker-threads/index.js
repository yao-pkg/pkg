'use strict';

const { Worker } = require('worker_threads');
const path = require('path');

function runWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { message: 'ping', name: 'world' },
    });

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Worker timed out'));
    }, 5000);

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
    console.log('helperResult:' + result.helperResult);
  } catch (e) {
    console.log('worker-error:' + e.message);
  }
}

main();
