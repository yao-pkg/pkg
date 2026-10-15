#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const utils = require('../utils.js');

// Enhanced SEA requires Node.js >= 22
if (utils.getNodeMajorVersion() < 22) {
  return;
}

assert(__dirname === process.cwd());

// Built at test time: git on Windows checks out a committed symlink as a text
// file, and a junction is what npm creates for workspace links there.
const libLink = path.join(__dirname, 'lib');
const innerLink = path.join(__dirname, 'reallib', 'inner.js');
const linkInfo = path.join(__dirname, 'linkinfo.json');
const generated = [libLink, innerLink, linkInfo];

function removeGenerated() {
  for (const p of generated) utils.vacuum.sync(p);
}

removeGenerated();

try {
  fs.symlinkSync(
    path.join(__dirname, 'reallib'),
    libLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  // A file symlink needs Developer Mode on Windows; index.js relaxes to match.
  let nestedIsLink = true;
  try {
    fs.symlinkSync('log.js', innerLink, 'file');
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    console.log(`  file symlink unavailable (${error.code}), using a copy`);
    fs.copyFileSync(path.join(__dirname, 'reallib', 'log.js'), innerLink);
    nestedIsLink = false;
  }
  fs.writeFileSync(linkInfo, `${JSON.stringify({ nestedIsLink }, null, 2)}\n`);

  const input = './package.json';
  const testName = 'test-99-#295';
  const standardOutput = 'test-output.exe';

  const expectedOutput = '42\n';

  const newcomers = utils.seaHostOutputs(testName).concat(standardOutput);

  const before = utils.filesBefore(newcomers);

  // SEA mode — the mode #295 was reported against.
  utils.runSeaHostOnly(input, testName);
  utils.assertSeaOutput(testName, expectedOutput);

  // Standard mode resolves symlinks through the same shared helper, so it
  // needs the same fixture: bootstrap.js was rewritten onto that helper in
  // #296 and would otherwise have no end-to-end coverage of the parent-symlink
  // walk.
  utils.pkg.sync(['--target', 'host', '--output', standardOutput, input]);
  assert.strictEqual(
    utils.spawn.sync(`./${standardOutput}`, []),
    expectedOutput,
  );

  utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
} finally {
  removeGenerated();
}
