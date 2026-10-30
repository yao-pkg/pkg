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
const otherLink = path.join(__dirname, 'reallib', 'other.js');
const linkInfo = path.join(__dirname, 'linkinfo.json');
const esmModules = path.join(__dirname, 'esm', 'node_modules');
const generated = [libLink, innerLink, otherLink, linkInfo, esmModules];

function removeGenerated() {
  for (const p of generated) utils.vacuum.sync(p);
}

removeGenerated();

const dirLinkType = process.platform === 'win32' ? 'junction' : 'dir';

try {
  fs.symlinkSync(path.join(__dirname, 'reallib'), libLink, dirLinkType);

  // A workspace package, linked the way npm links one into node_modules.
  fs.mkdirSync(path.join(esmModules, '@t'), { recursive: true });
  fs.symlinkSync(
    path.join(__dirname, 'reallib'),
    path.join(esmModules, '@t', 'lib'),
    dirLinkType,
  );

  // A file symlink needs Developer Mode on Windows; index.js relaxes to match.
  let nestedIsLink = true;
  try {
    fs.symlinkSync('log.js', innerLink, 'file');
    fs.symlinkSync('log.js', otherLink, 'file');
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    console.log(`  file symlink unavailable (${error.code}), using a copy`);
    for (const link of [innerLink, otherLink]) {
      utils.vacuum.sync(link);
      fs.copyFileSync(path.join(__dirname, 'reallib', 'log.js'), link);
    }
    nestedIsLink = false;
  }
  fs.writeFileSync(linkInfo, `${JSON.stringify({ nestedIsLink }, null, 2)}\n`);

  const expectedOutput = '42\n';
  // CJS entry with nested links, and the ESM workspace import from #295.
  const cases = [
    { input: './package.json', name: 'test-99-#295' },
    { input: './esm/package.json', name: 'test-99-#295-esm' },
  ];

  const newcomers = cases.flatMap(({ name }) =>
    utils.seaHostOutputs(name).concat(`${name}-std.exe`),
  );

  const before = utils.filesBefore(newcomers);

  for (const { input, name } of cases) {
    // SEA mode, the one #295 was reported against.
    utils.runSeaHostOnly(input, name);
    utils.assertSeaOutput(name, expectedOutput);

    // Standard mode shares the resolver, so it gets the same fixture.
    const standardOutput = `${name}-std.exe`;
    utils.pkg.sync(['--target', 'host', '--output', standardOutput, input]);
    assert.strictEqual(
      utils.spawn.sync(`./${standardOutput}`, []).replace(/\r\n/g, '\n'),
      expectedOutput,
      `standard mode output for ${input}`,
    );
  }

  utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
} finally {
  removeGenerated();
}
