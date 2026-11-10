#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

// package.json "imports" (subpath imports, `#name`): exact keys,
// conditions, `*` patterns, bare targets, used from ESM and CJS packages

const target = process.argv[2] || 'host';
const input = './package.json';
const output = './test-output.exe';

const expected = 'plain,node,internal,bare\ncjs:util\n';

const left = utils.spawn.sync('node', ['index.js']);
assert.strictEqual(left, expected);

const log = utils.pkg.sync(['--target', target, '--output', output, input], {
  stdio: 'pipe',
});
assert(
  !/Cannot find module '#/.test(log),
  `pkg should resolve package.json imports, got:\n${log}`,
);

const right = utils.spawn.sync(path.join(__dirname, output), [], {
  cwd: path.dirname(output),
});
assert.strictEqual(right, expected);

utils.vacuum.sync(output);
