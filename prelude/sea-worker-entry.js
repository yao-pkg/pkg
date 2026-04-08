'use strict';

// Worker thread VFS entry point.
// Bundled by esbuild at build time and inlined into the main bootstrap
// as a string. Uses the same @roberts_lando/vfs module hooks as the main
// thread — no hand-written VFS duplication.
//
// TODO: Remove the node_modules/@roberts_lando/vfs patches once
// https://github.com/platformatic/vfs/pull/9 is merged and released.

require('./sea-vfs-setup');
