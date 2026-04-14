#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

// Enhanced SEA requires Node.js >= 22
if (utils.getNodeMajorVersion() < 22) {
  return;
}

assert(__dirname === process.cwd());

const input = './package.json';

const newcomers = [
  'test-89-sea-fs-ops-linux',
  'test-89-sea-fs-ops-macos',
  'test-89-sea-fs-ops-win.exe',
];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input, '--sea'], { stdio: 'inherit' });

const expectedOutput =
  'exists-index:true\n' +
  'exists-missing:false\n' +
  'stat-isFile:true\n' +
  'stat-isDir:false\n' +
  'dir-isFile:false\n' +
  'dir-isDir:true\n' +
  'readdir:data.json,index.js,package.json\n' +
  'readFile:ok\n' +
  'stat-missing:ENOENT\n' +
  'read-missing:ENOENT\n';

utils.assertSeaOutput('test-89-sea-fs-ops', expectedOutput);

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
