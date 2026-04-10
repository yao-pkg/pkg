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
const platformSuffix = { linux: 'linux', darwin: 'macos', win32: 'win.exe' };
const suffix = platformSuffix[process.platform];
if (suffix) {
  const actual = utils.spawn
    .sync(`./test-sea-${suffix}`, [])
    .replace(/\r\n/g, '\n'); // Normalize Windows CRLF
  assert.equal(actual, 'Hello world\n', 'Output matches');
}

try {
  // FIXME: on windows this throws
  // Error: EBUSY: resource busy or locked, rmdir 'C:\Users\RUNNER~1\AppData\Local\Temp\pkg-sea\1729696609242'
  utils.filesAfter(before, newcomers);
} catch (_error) {
  // noop
}
