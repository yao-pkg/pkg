#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

// Worker thread support in SEA requires Node.js >= 22
if (utils.getNodeMajorVersion() < 22) {
  return;
}

assert(__dirname === process.cwd());

const input = './package.json';

const newcomers = [
  'test-90-sea-worker-threads-linux',
  'test-90-sea-worker-threads-macos',
  'test-90-sea-worker-threads-win.exe',
];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input, '--sea'], { stdio: 'inherit' });

const expected =
  'echo:ping\n' +
  'hasFilename:true\n' +
  'hasDirname:true\n' +
  'helperResult:hello world\n';

utils.assertSeaOutput('test-90-sea-worker-threads', expected);

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
