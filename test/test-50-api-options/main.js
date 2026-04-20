#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const input = './test-x-index.js';
const output = './test-output.exe';

utils.mkdirp.sync(path.dirname(output));

const { exec } = require('../../');

async function run() {
  // typed options object form
  await exec({
    input,
    targets: [target],
    output,
  });

  const result = utils.spawn.sync(output, [], {});
  assert.strictEqual(result, '42\n');
  utils.vacuum.sync(output);

  // array form still works (backward compat)
  await exec(['--target', target, '--output', output, input]);
  const result2 = utils.spawn.sync(output, [], {});
  assert.strictEqual(result2, '42\n');
  utils.vacuum.sync(output);

  // input validation
  let threw = false;
  try {
    await exec({});
  } catch (err) {
    threw = true;
    assert(/input/.test(err.message), `unexpected error: ${err.message}`);
  }
  assert(threw, 'exec({}) should have thrown');
}

run().catch(function (error) {
  console.error(error);
  process.exit(2);
});
