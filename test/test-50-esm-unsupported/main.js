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

// Test 2: top-level await detection
console.log('\n=== Test 2: top-level await ===');
{
  const input = './test-top-level-await.mjs';
  const output = './run-time/test-top-level-await.exe';
  const newcomers = ['run-time/test-top-level-await.exe'];

  const before = utils.filesBefore(newcomers);
  utils.mkdirp.sync(path.dirname(output));

  const result = utils.pkg.sync(
    ['--target', target, '--output', output, input],
    ['inherit', 'pipe', 'inherit'],
  );

  // Verify warning was emitted
  assert(
    result.includes('top-level await') ||
      result.includes('Cannot transform ESM module'),
    'Should warn about top-level await usage',
  );
  console.log('✓ top-level await detection working');

  // Cleanup
  utils.filesAfter(before, newcomers);
}

// Test 3: top-level for-await-of detection
console.log('\n=== Test 3: top-level for-await-of ===');
{
  const input = './test-for-await-of.mjs';
  const output = './run-time/test-for-await-of.exe';
  const newcomers = ['run-time/test-for-await-of.exe'];

  const before = utils.filesBefore(newcomers);
  utils.mkdirp.sync(path.dirname(output));

  const result = utils.pkg.sync(
    ['--target', target, '--output', output, input],
    ['inherit', 'pipe', 'inherit'],
  );

  // Verify warning was emitted
  assert(
    result.includes('for-await-of') ||
      result.includes('Cannot transform ESM module'),
    'Should warn about top-level for-await-of usage',
  );
  console.log('✓ top-level for-await-of detection working');

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

  // Verify warnings were emitted only for truly unsupported features
  const hasImportMeta = result.includes('import.meta');
  const hasTopLevelAwait = result.includes('top-level await');
  const hasForAwaitOf = result.includes('for-await-of');
  const hasGeneralWarning = result.includes('Cannot transform ESM module');

  // import.meta should NOT trigger a warning anymore (it's now supported)
  assert(
    !hasImportMeta,
    'Should NOT warn about import.meta (it is now supported)',
  );

  // But top-level await and for-await-of should still warn
  assert(
    hasTopLevelAwait || hasForAwaitOf || hasGeneralWarning,
    'Should warn about truly unsupported features (top-level await, for-await-of)',
  );

  console.log('✓ Multiple features detection working');
  console.log('  - import.meta detected:', hasImportMeta, '(should be false)');
  console.log('  - top-level await detected:', hasTopLevelAwait);
  console.log('  - top-level for-await-of detected:', hasForAwaitOf);

  // Cleanup
  utils.filesAfter(before, newcomers);
}

console.log(
  '\n✅ All ESM features correctly handled! (import.meta now supported, top-level await/for-await-of still unsupported)',
);
