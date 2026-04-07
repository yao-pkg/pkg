#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

// Enhanced SEA with ESM entry requires Node.js >= 25.7 (mainFormat: "module")
// and the VFS polyfill's module hooks. Skip until node:vfs lands in core.
if (utils.getNodeMajorVersion() < 26) {
  return;
}

assert(__dirname === process.cwd());

const input = './app/package.json';

const newcomers = [
  'test-87-sea-esm-linux',
  'test-87-sea-esm-macos',
  'test-87-sea-esm-win.exe',
];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input, '--sea'], { stdio: 'inherit' });

const expected = 'add:5\ngreeting:hello world\n';

if (process.platform === 'linux') {
  assert.equal(
    utils.spawn.sync('./test-87-sea-esm-linux', []),
    expected,
    'Output matches',
  );
} else if (process.platform === 'darwin') {
  assert.equal(
    utils.spawn.sync('./test-87-sea-esm-macos', []),
    expected,
    'Output matches',
  );
} else if (process.platform === 'win32') {
  assert.equal(
    utils.spawn.sync('./test-87-sea-esm-win.exe', []),
    expected,
    'Output matches',
  );
}

try {
  utils.filesAfter(before, newcomers);
} catch (_error) {
  // noop
}
