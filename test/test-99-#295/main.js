#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

// Enhanced SEA requires Node.js >= 22
if (utils.getNodeMajorVersion() < 22) {
  return;
}

assert(__dirname === process.cwd());

// test symlinks on unix only // TODO junction
if (process.platform === 'win32') return;

const input = './package.json';
const testName = 'test-99-#295';
const standardOutput = 'test-output.exe';

const expectedOutput = '42\n';

const newcomers = utils.seaHostOutputs(testName).concat(standardOutput);

const before = utils.filesBefore(newcomers);

// SEA mode — the mode #295 was reported against.
utils.runSeaHostOnly(input, testName);
utils.assertSeaOutput(testName, expectedOutput);

// Standard mode resolves symlinks through the same shared helper, so it needs
// the same fixture: bootstrap.js was rewritten onto that helper in #296 and
// would otherwise have no end-to-end coverage of the parent-symlink walk.
utils.pkg.sync(['--target', 'host', '--output', standardOutput, input]);
assert.strictEqual(utils.spawn.sync(`./${standardOutput}`, []), expectedOutput);

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
