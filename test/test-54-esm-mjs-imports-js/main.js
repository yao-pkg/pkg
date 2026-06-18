#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const input = './test-x-index.js';
const output = './run-time/test-output';

console.log('Testing .mjs importing .js (module-sync pattern)...');

let left, right;
utils.mkdirp.sync(path.dirname(output));

// Run with node first to get expected output
left = utils.spawn.sync('node', [input]);
console.log('Node output:', left.trim());

// Package with pkg
utils.pkg.sync(['--target', target, '--output', output, input], {
  stdio: 'inherit',
});

// Run packaged version
right = utils.spawn.sync('./' + path.basename(output), [], {
  cwd: path.dirname(output),
});
console.log('Packaged output:', right.trim());

assert.strictEqual(left.trim(), right.trim(), 'Outputs should match');

console.log('Test passed: .mjs importing .js works correctly');

utils.vacuum.sync(path.dirname(output));
