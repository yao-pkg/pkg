'use strict';

// SEA Bootstrap Core — runs all setup (VFS mount, shared patches,
// diagnostics, worker thread interception) but does NOT execute the
// user entrypoint. Both the CJS and ESM bootstraps consume this.
//
// TODO: Remove the node_modules/@roberts_lando/vfs patches once
// https://github.com/platformatic/vfs/pull/9 is merged and released.

var path = require('path');
var Module = require('module');
var shared = require('./bootstrap-shared');

// /////////////////////////////////////////////////////////////////
// VFS SETUP (shared with worker threads) //////////////////////////
// /////////////////////////////////////////////////////////////////

var vfs = require('./sea-vfs-setup');
var perf = vfs.perf;
var manifest = vfs.manifest;
var entrypoint = vfs.toPlatformPath(manifest.entrypoint);
var insideSnapshot = vfs.insideSnapshot;
var SNAPSHOT_PREFIX = vfs.SNAPSHOT_PREFIX;

// /////////////////////////////////////////////////////////////////
// SHARED PATCHES //////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

shared.patchDlopen(insideSnapshot);
shared.patchChildProcess(entrypoint);
shared.setupProcessPkg(entrypoint, manifest.entrypoint);

// /////////////////////////////////////////////////////////////////
// DIAGNOSTICS /////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

if (manifest.debug) {
  shared.installDiagnostic(SNAPSHOT_PREFIX);
}

// /////////////////////////////////////////////////////////////////
// WORKER THREAD SUPPORT ///////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

(function patchWorkerThreads() {
  var workerThreads;
  try {
    workerThreads = require('worker_threads');
  } catch (_) {
    return;
  }

  if (workerThreads.isMainThread === false) return;

  var OriginalWorker = workerThreads.Worker;
  var _fsForWorker = require('fs');

  var workerBootstrap = require('./_worker-bootstrap-string');

  workerThreads.Worker = function PatchedWorker(filename, options) {
    if (typeof filename === 'string' && insideSnapshot(filename)) {
      var workerCode;
      try {
        workerCode = _fsForWorker.readFileSync(filename, 'utf8');
      } catch (_e) {
        return new OriginalWorker(filename, options);
      }

      var wrapper =
        workerBootstrap +
        '\nvar _Module = require("module");\n' +
        'var _m = new _Module(' +
        JSON.stringify(filename) +
        ', module);\n' +
        '_m.filename = ' +
        JSON.stringify(filename) +
        ';\n' +
        '_m.paths = _Module._nodeModulePaths(' +
        JSON.stringify(path.dirname(filename)) +
        ');\n' +
        '_m._compile(' +
        JSON.stringify(workerCode) +
        ', ' +
        JSON.stringify(filename) +
        ');\n';

      options = Object.assign({}, options, { eval: true });
      return new OriginalWorker(wrapper, options);
    }

    return new OriginalWorker(filename, options);
  };

  Object.keys(OriginalWorker).forEach(function (key) {
    workerThreads.Worker[key] = OriginalWorker[key];
  });
  workerThreads.Worker.prototype = OriginalWorker.prototype;
})();

// /////////////////////////////////////////////////////////////////
// ENTRYPOINT PREP /////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

process.argv[1] = entrypoint;
Module._cache = Object.create(null);
try {
  process.mainModule = undefined;
} catch (_) {
  // process.mainModule may become read-only in future Node.js versions
}

// Start the module loading perf phase. Each dispatcher is responsible for
// calling perf.finalize() after the user entrypoint resolves so async /
// top-level-await apps get accurate module loading timings.
perf.start('module loading');

module.exports = {
  manifest: manifest,
  entrypoint: entrypoint,
  perf: perf,
};
