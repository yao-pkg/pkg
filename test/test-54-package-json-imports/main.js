#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

// package.json "imports" (subpath imports, `#name`): exact keys, conditions,
// `*` patterns and their precedence, array, bare and builtin targets, used
// from an ESM package, a CJS package and the app itself.
// Standard mode only: SEA mode doesn't resolve `#` specifiers yet.

const target = process.argv[2] || 'host';
const output = './run-time/test-output.exe';
const outputMissing = './run-time/test-output-missing.exe';

utils.mkdirp.sync(path.dirname(output));

const expected =
  'plain,node,internal,exact,tie,array,bare,builtin\ncjs:util,scope\napp\n';

const left = utils.spawn.sync('node', ['index.js']);
assert.strictEqual(left, expected);

const log = utils.pkg.sync(
  ['--target', target, '--output', output, './package.json'],
  { stdio: 'pipe' },
);
assert(
  !/Cannot find module '#/.test(log.stdout + log.stderr),
  `pkg should resolve package.json imports, got:\n${log.stdout}${log.stderr}`,
);

const right = utils.spawn.sync(output, []);
assert.strictEqual(right, expected);

// An import that is not defined: a warning with the reason when packaging,
// and an error that names the package.json when the binary runs

const logMissing = utils.pkg.sync(
  ['--target', target, '--output', outputMissing, './missing/package.json'],
  { stdio: 'pipe' },
);
assert.match(
  logMissing.stdout + logMissing.stderr,
  /Cannot find module '#undefined' from .*: not defined in "imports" of .*package\.json/,
);

const missing = utils.spawn.sync(outputMissing, [], {
  stdio: 'pipe',
  expect: 1,
});
assert.match(
  missing.stderr,
  /Cannot find module '#undefined' imported from .*index\.js: not defined in "imports" of .*package\.json/,
);
assert.match(missing.stderr, /code: 'MODULE_NOT_FOUND'/);

utils.vacuum.sync(path.dirname(output));
