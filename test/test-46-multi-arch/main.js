#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

// only linux has linux-arm64 counterpart
if (process.platform !== 'linux') return;

const opposite = { x64: 'arm64', arm: 'x64' };

const target = opposite[process.arch];
const input = './test-x-index.js';
const output = './test-output.exe';

const before = utils.filesBefore(['test-output.exe']);

utils.pkg.sync(['--target', target, '--output', output, input], {
  stdio: 'pipe',
});

utils.filesAfter(before, ['test-output.exe']);
