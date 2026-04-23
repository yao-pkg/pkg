#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const output = './test-output.exe';

// 1. Config file drives CLI-only flags. Entry prints "gc-on" only when
//    bakeOptions ('expose-gc') was honored via the pkg config. This also
//    exercises compress/public/publicPackages/noDictionary/bytecode/
//    fallbackToSource/signature flowing through the config.
utils.pkg.sync(['--target', target, '--output', output, '.'], {
  stdio: 'inherit',
});
assert.strictEqual(utils.spawn.sync(output, [], {}), 'gc-on\n');
utils.vacuum.sync(output);

// 2. CLI overrides config. Config baked 'expose-gc'; CLI `--options ""`
//    wins with an empty list, so gc is unavailable at runtime.
utils.pkg.sync(['--options', '', '--target', target, '--output', output, '.'], {
  stdio: 'inherit',
});
assert.strictEqual(utils.spawn.sync(output, [], {}), 'gc-off\n');
utils.vacuum.sync(output);

// 3. Invalid config value is reported, not silently ignored.
const bad = utils.pkg.sync(
  [
    '-c',
    'pkg.bad.json',
    '--target',
    target,
    '--output',
    output,
    'test-x-index.js',
  ],
  { stdio: 'pipe', expect: 2 },
);
assert(
  /"bytecode" must be a boolean/.test(bad.stdout + bad.stderr),
  `expected type-mismatch error, got:\n${bad.stdout}\n${bad.stderr}`,
);

// 4a. Non-object "pkg" field is rejected clearly.
const badPkg = utils.pkg.sync(
  [
    '-c',
    'pkg.not-object.json',
    '--target',
    target,
    '--output',
    output,
    'test-x-index.js',
  ],
  { stdio: 'pipe', expect: 2 },
);
assert(
  /"pkg" must be an object/.test(badPkg.stdout + badPkg.stderr),
  `expected "pkg must be an object" error, got:\n${badPkg.stdout}\n${badPkg.stderr}`,
);

// 4. Unknown key warns but does not fail.
const unknown = utils.pkg.sync(
  [
    '-c',
    'pkg.unknown.json',
    '--target',
    target,
    '--output',
    output,
    'test-x-index.js',
  ],
  { stdio: 'pipe' },
);
assert(
  /Unknown key "totallyNotARealKey"/.test(unknown.stdout + unknown.stderr),
  `expected unknown-key warning, got:\n${unknown.stdout}\n${unknown.stderr}`,
);
utils.vacuum.sync(output);
