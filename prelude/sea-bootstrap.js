'use strict';

// SEA Bootstrap (CJS) — used when target Node.js does not support
// sea-config mainFormat:"module" (Node < 25.7) or when the entrypoint is CJS.
//
// For ESM entrypoints on old Node: falls back to dynamic import(). The
// build-time warning (emitted by lib/sea.ts) explains the limitations.

var Module = require('module');
var core = require('./sea-bootstrap-core');

var manifest = core.manifest;
var entrypoint = core.entrypoint;

if (manifest.entryIsESM) {
  var _url = require('url');
  import(_url.pathToFileURL(entrypoint).href).catch(function (err) {
    console.error(err);
    process.exit(1);
  });
} else {
  Module.runMain();
}
