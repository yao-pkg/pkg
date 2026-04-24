'use strict';

const { parentPort, workerData } = require('worker_threads');

// Verify we can access __filename and __dirname
const hasFilename = typeof __filename === 'string' && __filename.length > 0;
const hasDirname = typeof __dirname === 'string' && __dirname.length > 0;

// Mirrors the main-thread compatibility contract: classic pkg sets
// `process.pkg` in every thread, so any userland library that gates
// behavior on `'pkg' in process` (a common pattern for picking cwd vs
// __dirname when resolving runtime paths) expects this in workers too.
const hasProcessPkg =
  typeof process.pkg === 'object' &&
  process.pkg !== null &&
  typeof process.pkg.entrypoint === 'string' &&
  process.pkg.entrypoint.length > 0;

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
  hasProcessPkg,
  helperResult,
});
