#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

// Enhanced SEA with ESM entry requires Node.js >= 26 (mainFormat: "module")
// and the VFS polyfill's module hooks. Skip until node:vfs lands in core.
// TODO: re-enable when node:vfs is available (https://github.com/nodejs/node/pull/61478)
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

utils.assertSeaOutput('test-87-sea-esm', 'add:5\ngreeting:hello world\n');

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
