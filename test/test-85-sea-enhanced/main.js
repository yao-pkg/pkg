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
  'test-85-sea-enhanced-linux',
  'test-85-sea-enhanced-macos',
  'test-85-sea-enhanced-win.exe',
];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input, '--sea'], { stdio: 'inherit' });

const expected =
  'hello from lib\n' +
  'main: got message\n' +
  'pkg-exists:true\n' +
  'pkg-entrypoint:true\n' +
  'pkg-path-resolve:true\n' +
  'pkg-mount:throws\n';

utils.assertSeaOutput('test-85-sea-enhanced', expected);

try {
  utils.filesAfter(before, newcomers);
} catch (_error) {
  // noop — Windows EBUSY workaround
}
