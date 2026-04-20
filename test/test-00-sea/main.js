#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

// sea is not supported on Node.js < 20
if (utils.getNodeMajorVersion() < 20) {
  return;
}

assert(__dirname === process.cwd());

const input = './test-sea.js';

// This is the one SEA test that cross-compiles: it builds binaries for
// all three supported target platforms so we keep coverage of pkg's
// SEA build path for non-host targets (postject invocation, node-archive
// download, platform-specific segment naming). The sibling SEA tests
// (test-85-sea-enhanced, etc.) build host-only to keep CI fast — they
// exercise SEA features that don't vary per target, so one cross-compile
// smoke test here is enough.
const newcomers = ['test-sea-linux', 'test-sea-macos', 'test-sea-win.exe'];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input, '--sea'], { stdio: 'inherit' });

utils.assertSeaOutput('test-sea', 'Hello world\n');

try {
  // FIXME: on windows this throws
  // Error: EBUSY: resource busy or locked, rmdir 'C:\Users\RUNNER~1\AppData\Local\Temp\pkg-sea\1729696609242'
  utils.filesAfter(before, newcomers);
} catch (_error) {
  // noop
}
