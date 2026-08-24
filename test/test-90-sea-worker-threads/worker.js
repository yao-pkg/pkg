'use strict';

const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

// Native addons can only be dlopen'd from a real filesystem path, so pkg
// patches process.dlopen to extract them from the snapshot first. Each
// worker thread gets its own `process`, so the main-thread patch does not
// carry over and has to be reapplied per thread.
//
// fake.node is not a loadable shared library, so dlopen throws either way.
// What distinguishes patched from unpatched is whether the addon was
// extracted to the native cache before dlopen was called.
let addonExtracted;
try {
  const addon = path.join(__dirname, 'lib', 'fake.node');
  try {
    require(addon);
  } catch (_e) {
    // expected — see above
  }
  const hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(addon))
    .digest('hex');
  addonExtracted = fs.existsSync(
    path.join(process.env.PKG_NATIVE_CACHE_PATH, 'pkg', hash, 'fake.node'),
  );
} catch (e) {
  addonExtracted = 'ERROR:' + e.message;
}

parentPort.postMessage({
  echo: workerData.message,
  hasFilename,
  hasDirname,
  hasProcessPkg,
  helperResult,
  addonExtracted,
});
