#!/usr/bin/env node

'use strict';

// Regression test for https://github.com/yao-pkg/pkg/issues/281
// Case A: import-only exports (ERR_PACKAGE_PATH_NOT_EXPORTED).
// Case B: exports targets pointing at renamed .mjs files (MODULE_NOT_FOUND).

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';

const cases = [
  { id: 'a', entry: './app/app-a.mjs', expected: 'esm-only ok' },
  { id: 'b', entry: './app/app-b.mjs', expected: 'req-mjs ok' },
];

for (const testCase of cases) {
  console.log(`Testing ESM exports conditions (case ${testCase.id})...`);

  const output = `./run-time/test-output-${testCase.id}.exe`;
  utils.mkdirp.sync(path.dirname(output));

  // Expected output from plain node.
  const left = utils.spawn.sync('node', [path.basename(testCase.entry)], {
    cwd: path.dirname(testCase.entry),
  });
  assert.strictEqual(left.trim(), testCase.expected);

  // Package with pkg.
  utils.pkg.sync(['--target', target, '--output', output, testCase.entry], {
    stdio: 'inherit',
  });

  // The packaged binary must run and produce the same output (no startup crash).
  const right = utils.spawn.sync('./' + path.basename(output), [], {
    cwd: path.dirname(output),
  });
  assert.strictEqual(
    left.trim(),
    right.trim(),
    `Outputs should match between node and pkg for case ${testCase.id}`,
  );

  console.log(`Test passed: case ${testCase.id}`);
}

utils.vacuum.sync('./run-time');
