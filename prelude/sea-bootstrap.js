'use strict';

// SEA Bootstrap for pkg
// This script runs before user code in a Node.js Single Executable Application.
// It sets up a Virtual File System from SEA-embedded assets so that
// fs.readFileSync, require, import, etc. work transparently on packaged files.
//
// TODO: Remove the node_modules/@platformatic/vfs patches once
// https://github.com/platformatic/vfs/pull/9 is merged and released.

var path = require('path');
var Module = require('module');
var shared = require('./bootstrap-shared');

// /////////////////////////////////////////////////////////////////
// VFS SETUP (shared with worker threads) //////////////////////////
// /////////////////////////////////////////////////////////////////

var vfs = require('./sea-vfs-setup');
var manifest = vfs.manifest;
var entrypoint = vfs.toPlatformPath(manifest.entrypoint);
var insideSnapshot = vfs.insideSnapshot;
var SNAPSHOT_PREFIX = vfs.SNAPSHOT_PREFIX;

// /////////////////////////////////////////////////////////////////
// SHARED PATCHES //////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Native addon extraction (shared with traditional bootstrap)
shared.patchDlopen(insideSnapshot);

// child_process patching (shared with traditional bootstrap)
shared.patchChildProcess(entrypoint);

// process.pkg setup (shared with traditional bootstrap)
shared.setupProcessPkg(entrypoint);

// /////////////////////////////////////////////////////////////////
// DIAGNOSTICS /////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Only available when the binary was built with --debug / -d.
// At runtime, set DEBUG_PKG=1 (VFS tree) or DEBUG_PKG=2 (+ fs tracing).
if (manifest.debug) {
  shared.installDiagnostic(SNAPSHOT_PREFIX);
}

// /////////////////////////////////////////////////////////////////
// WORKER THREAD SUPPORT ///////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Worker threads don't inherit VFS hooks from the main thread.
// Monkey-patch the Worker constructor so that when a worker is spawned
// with a /snapshot/... path, we inject a bundled VFS bootstrap that
// reuses the same @platformatic/vfs module hooks as the main thread.
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

  // Worker bootstrap is bundled separately by esbuild from sea-worker-entry.js
  // which requires the same sea-vfs-setup.js + @platformatic/vfs as the main
  // thread — no hand-written VFS duplication.
  var workerBootstrap = require('./_worker-bootstrap-string');

  workerThreads.Worker = function PatchedWorker(filename, options) {
    if (typeof filename === 'string' && insideSnapshot(filename)) {
      // Read the worker file from VFS
      var workerCode;
      try {
        workerCode = _fsForWorker.readFileSync(filename, 'utf8');
      } catch (_e) {
        // If we can't read from VFS, fall through to original
        return new OriginalWorker(filename, options);
      }

      var wrapper =
        workerBootstrap +
        '\n__filename = ' +
        JSON.stringify(filename) +
        ';\n__dirname = ' +
        JSON.stringify(path.dirname(filename)) +
        ';\nmodule.filename = __filename;\nmodule.paths = require("module")._nodeModulePaths(__dirname);\n' +
        workerCode;

      options = Object.assign({}, options, { eval: true });
      return new OriginalWorker(wrapper, options);
    }

    return new OriginalWorker(filename, options);
  };

  // Copy static properties and prototype
  Object.keys(OriginalWorker).forEach(function (key) {
    workerThreads.Worker[key] = OriginalWorker[key];
  });
  workerThreads.Worker.prototype = OriginalWorker.prototype;
})();

// /////////////////////////////////////////////////////////////////
// ENTRYPOINT //////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

process.argv[1] = entrypoint;
Module._cache = Object.create(null);
try {
  process.mainModule = undefined;
} catch (_) {
  // process.mainModule may become read-only in future Node.js versions
}
Module.runMain();
