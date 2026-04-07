#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

// Enhanced SEA requires Node.js >= 22
if (utils.getNodeMajorVersion() < 22) {
  return;
}

assert(__dirname === process.cwd());

const input = './package.json';

const newcomers = [
  'test-86-sea-assets-linux',
  'test-86-sea-assets-macos',
  'test-86-sea-assets-win.exe',
];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input, '--sea'], { stdio: 'inherit' });

const expected = 'config:test-value\ndata:hello world\n';

if (process.platform === 'linux') {
  assert.equal(
    utils.spawn.sync('./test-86-sea-assets-linux', []),
    expected,
    'Output matches',
  );
} else if (process.platform === 'darwin') {
  assert.equal(
    utils.spawn.sync('./test-86-sea-assets-macos', []),
    expected,
    'Output matches',
  );
} else if (process.platform === 'win32') {
  assert.equal(
    utils.spawn.sync('./test-86-sea-assets-win.exe', []),
    expected,
    'Output matches',
  );
}

try {
  utils.filesAfter(before, newcomers);
} catch (_error) {
  // noop
}
