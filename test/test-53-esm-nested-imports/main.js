#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const input = './esm-module/entry.mjs';
const output = './run-time/test-output.exe';

console.log(
  'Testing ESM nested imports (.mjs importing .mjs importing .mjs)...',
);

let left, right;
utils.mkdirp.sync(path.dirname(output));

// Run with node first to get expected output
console.log('Running with node...');
left = utils.spawn.sync('node', [path.basename(input)], {
  cwd: path.dirname(input),
});
console.log('Node output:', left);

// Package with pkg
console.log('Packaging with pkg...');
utils.pkg.sync(['--target', target, '--output', output, input], {
  stdio: 'inherit',
});
console.log('Packaging succeeded');

// Run packaged version
console.log('Running packaged version...');
right = utils.spawn.sync('./' + path.basename(output), [], {
  cwd: path.dirname(output),
});
console.log('Packaged output:', right);

// Verify outputs match
assert.strictEqual(
  left.trim(),
  right.trim(),
  'Outputs should match between node and pkg',
);

console.log('Test passed: ESM nested imports work correctly');

utils.vacuum.sync(path.dirname(output));
