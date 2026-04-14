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

// Step 2: Bundle both main bootstraps (CJS + ESM variants).
// - sea-bootstrap.bundle.js: CJS wrapper (default, and fallback for ESM
//   entrypoints on Node < 25.7 via dynamic import + warning)
// - sea-bootstrap-esm.bundle.mjs: ESM wrapper (used when target Node >= 25.7
//   and entrypoint is ESM — native top-level await support)
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

  esbuild.buildSync({
    entryPoints: [path.join(preludeDir, 'sea-bootstrap-esm.js')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: path.join(preludeDir, 'sea-bootstrap-esm.bundle.mjs'),
    external: ['node:sea', 'node:vfs'],
  });
} finally {
  // Clean up temp file
  try {
    fs.unlinkSync(tmpModulePath);
  } catch (_) {}
}
