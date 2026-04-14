#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const preludeDir = path.join(__dirname, '..', 'prelude');

// Step 1: Bundle the worker entry (sea-worker-entry.js → string).
// This bundles sea-vfs-setup.js + @roberts_lando/vfs into a single
// self-contained script that workers can eval.
const workerResult = esbuild.buildSync({
  entryPoints: [path.join(preludeDir, 'sea-worker-entry.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  write: false,
  external: ['node:sea', 'node:vfs'],
});

const workerCode = workerResult.outputFiles[0].text;

// Write the worker bootstrap as a string module so the main bootstrap
// can require() it at bundle time (esbuild inlines the require).
const tmpModulePath = path.join(preludeDir, '_worker-bootstrap-string.js');
fs.writeFileSync(
  tmpModulePath,
  `module.exports = ${JSON.stringify(workerCode)};\n`,
);

// Step 2: Bundle the CJS main bootstrap.
// Native ESM SEA main (mainFormat:"module", Node 25.7+) is disabled pending
// resolution of nodejs/node#62726 — see lib/sea.ts for details.
try {
  esbuild.buildSync({
    entryPoints: [path.join(preludeDir, 'sea-bootstrap.js')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(preludeDir, 'sea-bootstrap.bundle.js'),
    external: ['node:sea', 'node:vfs'],
  });
} finally {
  // Clean up temp file
  try {
    fs.unlinkSync(tmpModulePath);
  } catch (_) {}
}
