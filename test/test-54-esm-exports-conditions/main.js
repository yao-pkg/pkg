#!/usr/bin/env node

'use strict';

// Regression test for https://github.com/yao-pkg/pkg/issues/281 and #328
// esm-only: import-only exports (ERR_PACKAGE_PATH_NOT_EXPORTED).
// req-mjs: exports targets pointing at renamed .mjs files (MODULE_NOT_FOUND).
// esm-imports: import-only "imports" map pointing at a renamed .mjs file.
// cjs-imports: plain CJS "imports" map resolved from inside the snapshot,
// from a subdirectory (walk-up) and from a nested package.json scope.

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';

const cases = [
  { id: 'esm-only', entry: './app/app-a.mjs', expected: 'esm-only ok' },
  { id: 'req-mjs', entry: './app/app-b.mjs', expected: 'req-mjs ok' },
  { id: 'esm-imports', entry: './app/app-c.mjs', expected: 'esm-imports ok' },
  { id: 'cjs-imports', entry: './app/app-d.mjs', expected: 'cjs-imports ok' },
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
