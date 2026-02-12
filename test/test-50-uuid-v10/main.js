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

let left, right;
utils.mkdirp.sync(path.dirname(output));

// Install the ESM package first
console.log('Installing uuid v10 (ESM-only)...');
utils.exec.sync('npm install --no-package-lock --no-save', {
  stdio: 'inherit',
});

// Run the test with node first to verify expected output
// Note: uuid v10+ is ESM-only and will fail with Node.js require()
try {
  left = utils.spawn.sync('node', [path.basename(input)], {
    cwd: path.dirname(input),
  });
} catch (_error) {
  // Expected to fail with ESM error - uuid v10+ is ESM-only
  console.log(
    'Expected ESM error occurred - Node cannot require() ESM modules (uuid v10+)',
  );
  left = 'Expected ESM error occurred';
}

// Package the application
utils.pkg.sync(['--target', target, '--output', output, input]);

// Run the packaged executable
right = utils.spawn.sync('./' + path.basename(output), [], {
  cwd: path.dirname(output),
});

// Verify packaged version works
// Note: UUID v7 generates time-based UUIDs, so we need to normalize before comparing
if (left.trim() === 'Expected ESM error occurred') {
  // Packaged version should work and produce 'ok'
  assert.strictEqual(right, 'ok\n', 'Packaged version should output ok');
  console.log(
    '✅ Test passed! pkg successfully transformed and packaged ESM module',
  );
} else {
  // If node worked, normalize outputs (remove dynamic UUIDs) before comparing
  const normalizeOutput = (str) =>
    str.replace(
      /UUID v7: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      'UUID v7',
    );

  const normalizedLeft = normalizeOutput(left);
  const normalizedRight = normalizeOutput(right);

  assert.strictEqual(normalizedLeft, normalizedRight, 'Outputs should match');
  console.log('✅ Test passed! Both node and pkg produced the same output');
}

// Cleanup
utils.vacuum.sync(path.dirname(output));
