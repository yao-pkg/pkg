#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const host = 'node' + utils.getNodeMajorVersion();
const target = process.argv[2] || host;

console.log('Testing top-level await support with esbuild...');

// Test 1: Top-level await without imports
console.log('\n=== Test 1: Top-level await without imports ===');
{
  const input = './test-x-index.mjs';
  const output = './test-output.exe';

  // Package the file with top-level await
  utils.pkg.sync(['--target', target, '--output', output, input]);

  // Run the packaged executable
  const right = utils.spawn.sync('./' + path.basename(output), [], {
    cwd: path.dirname(output),
  });

  // Expected output
  const expected =
    [
      'Top-level await completed',
      'Number: 1',
      'Number: 2',
      'Number: 3',
      'For-await-of completed',
    ].join('\n') + '\n';

  assert.strictEqual(right, expected, 'Top-level await should work correctly');

  console.log('✅ Top-level await test passed!');

  utils.vacuum.sync(output);
}

// Test 2: Top-level await WITH imports
console.log('\n=== Test 2: Top-level await with imports ===');
{
  const input = './test-x-with-imports.mjs';
  const output = './test-output-imports.exe';

  // Package the file with top-level await and imports
  utils.pkg.sync(['--target', target, '--output', output, input]);

  // Run the packaged executable
  const right = utils.spawn.sync('./' + path.basename(output), [], {
    cwd: path.dirname(output),
  });

  // Expected output
  const expected =
    [
      'Top-level await with imports completed',
      'Item: item1',
      'Item: item2',
      'Item: item3',
      'For-await-of with imports completed',
    ].join('\n') + '\n';

  assert.strictEqual(
    right,
    expected,
    'Top-level await with imports should work correctly',
  );

  console.log('✅ Top-level await with imports test passed!');

  utils.vacuum.sync(output);
}

console.log('\n✅ All top-level await tests passed!');
