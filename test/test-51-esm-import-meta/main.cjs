#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';

console.log('Testing import.meta support in packaged executables...');

// Test: Package and run an ESM module that uses import.meta
console.log('\n=== Test: import.meta properties ===');
{
  const input = './test-import-meta-basic.js';
  const output = './run-time/test-import-meta-basic.exe';
  const newcomers = ['run-time/test-import-meta-basic.exe'];

  const before = utils.filesBefore(newcomers);
  utils.mkdirp.sync(path.dirname(output));

  // Package the executable
  const buildResult = utils.pkg.sync(
    ['--target', target, '--output', output, input],
    ['inherit', 'pipe', 'inherit'],
  );

  // Should NOT warn about import.meta
  assert(
    !buildResult.includes('import.meta') &&
      !buildResult.includes('Cannot transform ESM module'),
    'Should NOT warn about import.meta usage',
  );

  console.log('✓ Packaging succeeded without warnings');

  // Run the executable and check output
  const runResult = spawnSync(output, [], {
    encoding: 'utf8',
    timeout: 10000,
  });

  console.log('Executable output:');
  console.log(runResult.stdout);

  if (runResult.stderr) {
    console.log('Executable stderr:');
    console.log(runResult.stderr);
  }

  assert(
    runResult.status === 0,
    `Executable should exit with code 0, got ${runResult.status}`,
  );

  assert(
    runResult.stdout.includes('import.meta.url works'),
    'Should show import.meta.url working',
  );

  assert(
    runResult.stdout.includes('import.meta.dirname works'),
    'Should show import.meta.dirname working',
  );

  assert(
    runResult.stdout.includes('import.meta.filename works'),
    'Should show import.meta.filename working',
  );

  assert(
    runResult.stdout.includes('All import.meta properties work correctly'),
    'Should show success message',
  );

  console.log('✓ Executable runs correctly with import.meta support');

  // Cleanup
  utils.filesAfter(before, newcomers);
}

console.log('\n✅ All import.meta tests passed!');
