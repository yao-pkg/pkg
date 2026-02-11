#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const { existsSync } = require('fs');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';

console.log('Testing ESM features detection and transformation...');

// Test 1: import.meta support (should now work without warnings)
console.log('\n=== Test 1: import.meta support ===');
{
  const input = './test-import-meta.mjs';
  const output = './run-time/test-import-meta.exe';
  const newcomers = ['run-time/test-import-meta.exe'];

  const before = utils.filesBefore(newcomers);
  utils.mkdirp.sync(path.dirname(output));

  // Capture stdout to check that no warnings are emitted
  const result = utils.pkg.sync(
    ['--target', target, '--output', output, input],
    ['inherit', 'pipe', 'inherit'],
  );

  // Verify NO warning was emitted (import.meta should now be supported)
  assert(
    !result.includes('import.meta') &&
      !result.includes('Cannot transform ESM module'),
    'Should NOT warn about import.meta usage (it is now supported)',
  );

  // Verify the executable was created
  assert(existsSync(output), 'Executable should be created successfully');

  console.log(
    '✓ import.meta support working (no warnings, executable created)',
  );

  // Cleanup
  utils.filesAfter(before, newcomers);
}

// Test 2: top-level await support (should now work!)
console.log('\n=== Test 2: top-level await ===');
{
  const input = './test-top-level-await.mjs';
  const output = './run-time/test-top-level-await.exe';
  const newcomers = ['run-time/test-top-level-await.exe'];

  const before = utils.filesBefore(newcomers);
  utils.mkdirp.sync(path.dirname(output));

  // Package the file with top-level await
  utils.pkg.sync(
    ['--target', target, '--output', output, input],
    ['inherit', 'pipe', 'inherit'],
  );

  // Run the executable and verify it works
  const execResult = utils.spawn.sync('./' + path.basename(output), [], {
    cwd: path.dirname(output),
  });

  assert(
    execResult.includes('Top-level await completed'),
    'Should successfully execute top-level await code',
  );
  console.log('✓ top-level await now supported');

  // Cleanup
  utils.filesAfter(before, newcomers);
}

// Test 3: top-level for-await-of support (should now work!)
console.log('\n=== Test 3: top-level for-await-of ===');
{
  const input = './test-for-await-of.mjs';
  const output = './run-time/test-for-await-of.exe';
  const newcomers = ['run-time/test-for-await-of.exe'];

  const before = utils.filesBefore(newcomers);
  utils.mkdirp.sync(path.dirname(output));

  // Package the file with top-level for-await-of
  utils.pkg.sync(
    ['--target', target, '--output', output, input],
    ['inherit', 'pipe', 'inherit'],
  );

  // Run the executable and verify it works
  const execResult = utils.spawn.sync('./' + path.basename(output), [], {
    cwd: path.dirname(output),
  });

  assert(
    execResult.includes('Top-level for-await-of completed'),
    'Should successfully execute top-level for-await-of code',
  );
  console.log('✓ top-level for-await-of now supported');

  // Cleanup
  utils.filesAfter(before, newcomers);
}

// Test 4: multiple ESM features working together
console.log('\n=== Test 4: multiple ESM features ===');
{
  const input = './test-multiple-features.mjs';
  const output = './run-time/test-multiple.exe';
  const newcomers = ['run-time/test-multiple.exe'];

  const before = utils.filesBefore(newcomers);
  utils.mkdirp.sync(path.dirname(output));

  utils.pkg.sync(
    ['--target', target, '--output', output, input],
    ['inherit', 'pipe', 'inherit'],
  );

  // Verify executable was created successfully (all features now supported)
  assert(
    existsSync(output),
    'Executable should be created with all ESM features',
  );

  // Run the executable and verify it works
  const execResult = utils.spawn.sync(`./${path.basename(output)}`, [], {
    cwd: path.dirname(output),
  });

  assert(
    execResult.includes('ok with multiple features'),
    'Should execute successfully with all ESM features',
  );

  console.log(
    '✓ Multiple ESM features working together (import.meta + top-level await + for-await-of)',
  );

  // Cleanup
  utils.filesAfter(before, newcomers);
}

console.log('\n✅ ESM features test completed!');
console.log('  - import.meta is now supported with polyfills');
console.log('  - top-level await is now supported with async IIFE wrapper');
console.log(
  '  - top-level for-await-of is now supported with async IIFE wrapper',
);
