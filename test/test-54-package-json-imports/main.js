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
// package.json is above it. Two targets are `.mjs` files, which the packer
// stores as `.js`; one of them only has an "import" condition (#328). A
// package without package.json inside node_modules doesn't inherit the
// "imports" of the package around it.

const target = process.argv[2] || 'host';
const input = './bin/index.js';
const output = './run-time/test-output.exe';

utils.mkdirp.sync(path.dirname(output));

const resolvedWith = (noScope) =>
  'plain,node,internal,bare,builtin,mjs,esm-only\n' +
  `cjs:util,scope,${noScope}\napp\n`;
const resolved = resolvedWith('MODULE_NOT_FOUND');
const expected =
  resolved +
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

// SEA mode shares the walker but resolves `#` imports in its own VFS layer,
// which reports every failure as MODULE_NOT_FOUND and doesn't stop the scope
// lookup at node_modules yet (no-scope resolves the outer "#util")
const testName = 'test-54-package-json-imports';
const newcomers = utils.seaHostOutputs(testName);
const before = utils.filesBefore(newcomers);
utils.runSeaHostOnly('./package.json', testName);
utils.assertSeaOutput(
  testName,
  resolvedWith('util') +
    'MODULE_NOT_FOUND MODULE_NOT_FOUND MODULE_NOT_FOUND MODULE_NOT_FOUND\n',
);
utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });

utils.vacuum.sync(path.dirname(output));
