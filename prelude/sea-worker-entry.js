'use strict';

// Worker thread VFS entry point.
// Bundled by esbuild at build time and inlined into the main bootstrap
// as a string. Uses the same @roberts_lando/vfs module hooks as the main
// thread — no hand-written VFS duplication.
//
// TODO: Remove the node_modules/@roberts_lando/vfs patches once
// https://github.com/platformatic/vfs/pull/9 is merged and released.

var vfs = require('./sea-vfs-setup');
var shared = require('./bootstrap-shared');

// Mirror the main-thread setup for process.pkg so userland checks like
// `'pkg' in process` / `process.pkg.entrypoint` behave consistently across
// threads. In classic (non-SEA) pkg the worker bootstrap runs the same code
// path as the main thread and sets this up; without it, libraries that gate
// packaged-vs-filesystem logic on `process.pkg` misbehave in workers (e.g.,
// a pino transport that resolves paths through such a check writes into the
// read-only snapshot and hangs waiting for `open`).
shared.setupProcessPkg(
  vfs.toPlatformPath(vfs.manifest.entrypoint),
  vfs.manifest.entrypoint,
);
