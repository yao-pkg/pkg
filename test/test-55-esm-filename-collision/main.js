#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const output = './test-output.exe';
const expected = 'from-cjs from-esm';

const source = utils.spawn.sync('node', ['./app/entry.mjs']);
assert.strictEqual(source.trim(), expected);

try {
  utils.pkg.sync(['--target', target, '--output', output, './app'], {
    stdio: 'inherit',
  });
  const packaged = utils.spawn.sync(output, []);
  assert.strictEqual(packaged.trim(), expected);
} finally {
  utils.vacuum.sync(output);
}
