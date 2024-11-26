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

const newcomers = ['test-sea-linux', 'test-sea-macos', 'test-sea-win.exe'];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input, '--sea'], { stdio: 'inherit' });

// try to spawn one file based on the platform
if (process.platform === 'linux') {
  assert.equal(
    utils.spawn.sync('./test-sea-linux', []),
    'Hello world\n',
    'Output matches',
  );
} else if (process.platform === 'darwin') {
  assert.equal(
    utils.spawn.sync('./test-sea-macos', []),
    'Hello world\n',
    'Output matches',
  );
} else if (process.platform === 'win32') {
  assert.equal(
    utils.spawn.sync('./test-sea-win.exe', []),
    'Hello world\n',
    'Output matches',
  );
}

utils.filesAfter(before, newcomers);
