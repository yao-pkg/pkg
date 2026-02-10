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
console.log('Installing ESM package...');
utils.exec.sync('npm install --no-package-lock --no-save', {
  stdio: 'inherit',
});

// Run with node first
// Note: This will fail with ESM error because Node.js can't require() ESM modules
// But pkg should be able to package and run it successfully after transformation
console.log('Running with node...');
try {
  left = utils.spawn.sync('node', [path.basename(input)], {
    cwd: path.dirname(input),
  });
  console.log('Node output:', left);
} catch (error) {
  // Expected to fail with ESM error
  const errorStr = String(error);
  if (errorStr.includes('ES Module') || errorStr.includes('ERR_REQUIRE_ESM')) {
    console.log(
      'Expected ESM error occurred - Node cannot require() ESM modules',
    );
    left = 'Expected ESM error occurred';
  } else {
    console.error('Unexpected error running with node:', error);
    throw error;
  }
}

// Try to package
console.log('Packaging with pkg...');
try {
  utils.pkg.sync(['--target', target, '--output', output, input], {
    stdio: 'inherit',
  });
  console.log('Packaging succeeded');
} catch (error) {
  console.error('Error during packaging:', error);
  throw error;
}

// Try to run packaged version
console.log('Running packaged version...');
try {
  right = utils.spawn.sync('./' + path.basename(output), [], {
    cwd: path.dirname(output),
  });
  console.log('Packaged output:', right);
} catch (error) {
  console.error('Error running packaged version:', error);
  throw error;
}

// Verify packaged version works
// Note: nanoid generates random IDs, so we need to normalize before comparing
if (left.trim() === 'Expected ESM error occurred') {
  // Packaged version should work and produce output
  assert(
    right.includes('Generated ID:'),
    'Packaged version should generate ID',
  );
  assert(right.includes('ok'), 'Packaged version should output ok');
  console.log(
    '✅ Test passed! pkg successfully transformed and packaged ESM module',
  );
} else {
  // If node worked, normalize outputs (remove dynamic IDs) before comparing
  const normalizeOutput = (str) =>
    str.replace(/Generated ID: [A-Za-z0-9_-]+/g, 'Generated ID');

  const normalizedLeft = normalizeOutput(left);
  const normalizedRight = normalizeOutput(right);

  assert.strictEqual(normalizedLeft, normalizedRight, 'Outputs should match');
  console.log('✅ Test passed! Both node and pkg produced the same output');
}

utils.vacuum.sync(path.dirname(output));
