#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const input = './test-x-index.js';
const gcInput = './test-y-index.js';
const output = './test-output.exe';

utils.mkdirp.sync(path.dirname(output));

const { exec } = require('../../');

async function run() {
  // typed options object form — minimal
  await exec({
    input,
    targets: [target],
    output,
  });
  assert.strictEqual(utils.spawn.sync(output, [], {}), '42\n');
  utils.vacuum.sync(output);

  // array form still works (backward compat)
  await exec(['--target', target, '--output', output, input]);
  assert.strictEqual(utils.spawn.sync(output, [], {}), '42\n');
  utils.vacuum.sync(output);

  // exercise field mappings that would silently no-op on a typo in
  // optionsToParsed: bakeOptions reaches the packaged binary only if the
  // '--options' key name is correct.
  await exec({
    input: gcInput,
    targets: [target],
    output,
    bakeOptions: ['expose-gc'],
    publicPackages: ['*'],
    noDictionary: ['*'],
  });
  assert.strictEqual(utils.spawn.sync(output, [], {}), 'gc-on\n');
  utils.vacuum.sync(output);

  // compression path
  await exec({
    input,
    targets: [target],
    output,
    compress: 'Brotli',
  });
  assert.strictEqual(utils.spawn.sync(output, [], {}), '42\n');
  utils.vacuum.sync(output);

  // input validation — missing input
  await assertThrows(
    () => exec({}),
    'options.input',
    'exec({}) should have thrown',
  );

  // input validation — non-object
  await assertThrows(
    () => exec(null),
    'must be an object',
    'exec(null) should have thrown',
  );
}

async function assertThrows(fn, expectedSubstring, message) {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    assert(
      err.message.includes(expectedSubstring),
      `unexpected error: ${err.message}`,
    );
  }
  assert(threw, message);
}

run().catch(function (error) {
  console.error(error);
  process.exit(2);
});
