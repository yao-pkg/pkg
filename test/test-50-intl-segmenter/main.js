#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const input = './test-x-index.js';
const output = './test-output.exe';

utils.pkg.sync(['--target', target, '--output', output, input]);

// spawn.sync fails the test on a non-zero status or any signal, so a
// SIGSEGV here is caught without an explicit assertion.
const right = utils.spawn.sync(output, [], {});
const lines = right.split('\n');

assert.strictEqual(lines[2], 'ALIVE');

if (lines[0] === 'BROKEN:true') {
  // small-icu base, no break-iterator data: the prelude must have turned
  // the crash into something catchable.
  assert.strictEqual(lines[1], 'THREW:RangeError');
} else {
  // full-icu base (or NODE_ICU_DATA supplied): the prelude must stay out
  // of the way. '⠋ hi ✔' is 6 grapheme clusters.
  assert.strictEqual(lines[1], 'SEGMENTED:6');
}

utils.vacuum.sync(output);
