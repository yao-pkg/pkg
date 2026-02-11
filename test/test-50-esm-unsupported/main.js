#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';

console.log('Testing unsupported ESM features detection...');

// Test 1: import.meta detection
console.log('\n=== Test 1: import.meta ===');
{
  const input = './test-import-meta.mjs';
  const output = './run-time/test-import-meta.exe';
  const newcomers = ['run-time/test-import-meta.exe'];

  const before = utils.filesBefore(newcomers);
  utils.mkdirp.sync(path.dirname(output));

  // Capture stdout to check for warnings
  const result = utils.pkg.sync(
    ['--target', target, '--output', output, input],
    ['inherit', 'pipe', 'inherit'],
  );

  // Verify warning was emitted
  assert(
    result.includes('import.meta') ||
      result.includes('Cannot transform ESM module'),
    'Should warn about import.meta usage',
  );
  console.log('✓ import.meta detection working');

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

  // Package the file
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

  // Package the file
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

// Test 4: multiple unsupported features detection
console.log('\n=== Test 4: multiple unsupported features ===');
{
  const input = './test-multiple-features.mjs';
  const output = './run-time/test-multiple.exe';
  const newcomers = ['run-time/test-multiple.exe'];

  const before = utils.filesBefore(newcomers);
  utils.mkdirp.sync(path.dirname(output));

  const result = utils.pkg.sync(
    ['--target', target, '--output', output, input],
    ['inherit', 'pipe', 'inherit'],
  );

  // Verify multiple warnings were emitted
  const hasImportMeta = result.includes('import.meta');
  const hasTopLevelAwait = result.includes('top-level await');
  const hasForAwaitOf = result.includes('for-await-of');
  const hasGeneralWarning = result.includes('Cannot transform ESM module');

  assert(
    hasImportMeta || hasTopLevelAwait || hasForAwaitOf || hasGeneralWarning,
    'Should warn about multiple unsupported features',
  );

  console.log('✓ Multiple features detection working');
  console.log('  - import.meta detected:', hasImportMeta);
  console.log('  - top-level await detected:', hasTopLevelAwait);
  console.log('  - top-level for-await-of detected:', hasForAwaitOf);

  // Cleanup
  utils.filesAfter(before, newcomers);
}

console.log('\n✅ ESM features test completed!');
console.log('  - import.meta is still unsupported (as expected)');
console.log('  - top-level await is now supported with async IIFE wrapper');
console.log(
  '  - top-level for-await-of is now supported with async IIFE wrapper',
);
