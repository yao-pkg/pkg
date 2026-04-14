'use strict';

const { parentPort, workerData } = require('worker_threads');

// Verify we can access __filename and __dirname
const hasFilename = typeof __filename === 'string' && __filename.length > 0;
const hasDirname = typeof __dirname === 'string' && __dirname.length > 0;

// Verify we can require a relative module from within the worker
let helperResult;
try {
  const helper = require('./lib/helper.js');
  helperResult = helper.greet(workerData.name);
} catch (e) {
  helperResult = 'ERROR:' + e.message;
}

parentPort.postMessage({
  echo: workerData.message,
  hasFilename,
  hasDirname,
  helperResult,
});
