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
// - sea-bootstrap.bundle.js: CJS wrapper (default, and fallback for targets
//   that cannot use mainFormat:"module")
// - sea-bootstrap-esm.bundle.mjs: ESM wrapper (used when target Node >= 25.7
//   AND the embedder dynamic-import callback resolves non-builtin modules
//   — see nodejs/node#62726 for the current upstream gate)
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
    // Polyfill `require` inside the ESM bundle so that the bundled CJS
    // core (sea-bootstrap-core.js) can load Node builtins via its
    // existing `require('path')` calls. Without this, esbuild's
    // __require fallback throws "Dynamic require of X is not supported".
    banner: {
      js: "import { createRequire as __pkgCreateRequire } from 'module';\nconst require = __pkgCreateRequire(import.meta.url);",
    },
  });
} finally {
  // Clean up temp file
  try {
    fs.unlinkSync(tmpModulePath);
  } catch (_) {}
}
