#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const input = './test-x-index.js';
const output = './test-output.exe';

let right;

utils.pkg.sync(['--target', target, '--output', output, input]);

right = utils.spawn.sync('./' + path.basename(output), [], {
  cwd: path.dirname(output),
});

assert.strictEqual(
  right,
  'true\n' +
    'false\n' +
    'Cannot write to packaged file\n' +
    'true\n' +
    'closed\n' +
    'false\n' +
    'Cannot write to packaged file\n' +
    'Cannot write to packaged file\n' +
    'undefined\n' +
    'Cannot write to packaged file\n' +
    'undefined\n',
);

utils.vacuum.sync(output);
