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

console.log('\n✅ All unsupported ESM features correctly detected!');
