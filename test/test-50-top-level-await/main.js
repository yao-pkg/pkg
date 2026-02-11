#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const host = 'node' + utils.getNodeMajorVersion();
const target = process.argv[2] || host;
const input = './test-x-index.mjs';
const output = './test-output.exe';

console.log('Testing top-level await support with esbuild...');

let right;

// Package the file with top-level await
utils.pkg.sync(['--target', target, '--output', output, input]);

// Run the packaged executable
right = utils.spawn.sync('./' + path.basename(output), [], {
  cwd: path.dirname(output),
});

// Expected output
const expected =
  [
    'Top-level await completed',
    'Number: 1',
    'Number: 2',
    'Number: 3',
    'For-await-of completed',
  ].join('\n') + '\n';

assert.strictEqual(right, expected, 'Top-level await should work correctly');

console.log('✅ Top-level await test passed!');

utils.vacuum.sync(output);
