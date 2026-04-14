'use strict';

// SEA Bootstrap (CJS) — always used in enhanced SEA mode.
//
// Node 25.5+ compiles the SEA main as an embedder module whose `require`
// and `importModuleDynamicallyForEmbedder` hooks only resolve builtin
// modules — any attempt to load the user entrypoint directly from here
// throws ERR_UNKNOWN_BUILTIN_MODULE. See nodejs/node#62726.
//
// Workaround:
//
//   - CJS entries: call Module.runMain(). Module is a builtin so
//     require('module') works; Module.runMain goes through the real CJS
//     loader (and transparently handles ESM entries via require(esm) on
//     Node 22.12+).
//
//   - ESM entries: compile a one-liner via vm.Script with
//     `importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER`.
//     Dynamic import() inside that script is routed to the *default*
//     ESM loader instead of the embedder-only callback, so file URLs
//     resolve and top-level await in the user entry works.
//
// We prefer the vm.Script path for ESM entries specifically because
// require(esm) rejects modules with top-level await, while the default
// loader's dynamic import() supports TLA.

var Module = require('module');
var core = require('./sea-bootstrap-core');

var manifest = core.manifest;
var entrypoint = core.entrypoint;
var perf = core.perf;

process.argv[1] = entrypoint;

if (manifest.entryIsESM) {
  var vm = require('vm');
  var url = require('url');

  // Suppress the ExperimentalWarning emitted once on first use of
  // vm.USE_MAIN_CONTEXT_DEFAULT_LOADER. We chain it onto the original
  // emitWarning so every other warning still reaches listeners.
  var origEmitWarning = process.emitWarning;
  process.emitWarning = function (warning) {
    var msg =
      typeof warning === 'string' ? warning : warning && warning.message;
    if (msg && msg.indexOf('vm.USE_MAIN_CONTEXT_DEFAULT_LOADER') !== -1) {
      return;
    }
    return origEmitWarning.apply(this, arguments);
  };

  var entryUrl = url.pathToFileURL(entrypoint).href;
  var script = new vm.Script('import(' + JSON.stringify(entryUrl) + ')', {
    filename: 'pkg-sea-bootstrap-shim.js',
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });

  script
    .runInThisContext()
    .catch(function (err) {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(function () {
      perf.finalize();
    });
} else {
  try {
    Module.runMain();
  } finally {
    perf.finalize();
  }
}
