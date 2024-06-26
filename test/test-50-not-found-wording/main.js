#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const input = './test-x-index.js';
const output = './run-time/test-output.exe';

let right;
utils.mkdirp.sync(path.dirname(output));

utils.pkg.sync(['--target', target, '--output', output, input]);

right = utils.spawn.sync('./' + path.basename(output), [], {
  cwd: path.dirname(output),
});

assert(
  right
    .split('*****')[0]
    .indexOf('was not included into executable at compilation stage') >= 0,
);

assert(right.split('*****')[1].indexOf('you want to compile the package') >= 0);

utils.vacuum.sync(path.dirname(output));
