#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

// package.json "imports" (subpath imports, `#name`) in an ESM package, a CJS
// package and the app. The entry is in a subdirectory, so the app's
// package.json is above it. One target is an `.mjs` file, which the packer
// stores as `.js`.

const target = process.argv[2] || 'host';
const input = './bin/index.js';
const output = './run-time/test-output.exe';
const outputSea = './run-time/test-output-sea.exe';

utils.mkdirp.sync(path.dirname(output));

const expected =
  'plain,node,internal,bare,builtin,mjs\ncjs:util,scope\napp\n' +
  'ERR_PACKAGE_IMPORT_NOT_DEFINED ERR_PACKAGE_IMPORT_NOT_DEFINED ' +
  'MODULE_NOT_FOUND ERR_INVALID_PACKAGE_TARGET\n';

const left = utils.spawn.sync('node', [input]);
assert.strictEqual(left, expected);

const log = utils.pkg.sync(['--target', target, '--output', output, input], {
  stdio: 'pipe',
});
// the entry's four broken imports are expected to be reported
const unresolved = (log.stdout + log.stderr).match(
  /Cannot find module '#[^']+'/g,
);
assert.deepStrictEqual(
  [...new Set(unresolved)].sort(),
  ['#browser-only', '#invalid-target', '#missing-file', '#undefined'].map(
    (specifier) => `Cannot find module '${specifier}'`,
  ),
);

const right = utils.spawn.sync(output, []);
assert.strictEqual(right, expected);

// The app's package.json is bundled for its "imports" only: neither its
// "files" (as plain source) nor its "dependencies" come with it
const binary = fs.readFileSync(output);
assert(binary.includes('"#app/*"'));
assert(!binary.includes('plain-source-marker'));
assert(!binary.includes('unused-dependency-marker'));

// SEA mode shares the walker, but resolves `#` imports in its own VFS layer,
// which reports every failure as MODULE_NOT_FOUND: compare the resolved part

utils.pkg.sync(
  ['./package.json', '--sea', '--target', 'host', '--output', outputSea],
  { stdio: 'pipe' },
);
const sea = utils.spawn.sync(outputSea, []).replace(/\r\n/g, '\n');
assert.strictEqual(
  sea.split('\n').slice(0, 3).join('\n'),
  expected.split('\n').slice(0, 3).join('\n'),
);

try {
  utils.vacuum.sync(path.dirname(output));
} catch (error) {
  // Windows briefly keeps a lock on a SEA binary that just ran
  if (process.platform !== 'win32' || error.code !== 'EBUSY') throw error;
}
