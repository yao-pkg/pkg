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
const testName = 'test-90-sea-worker-threads';

const newcomers = utils.seaHostOutputs(testName);

const before = utils.filesBefore(newcomers);

utils.runSeaHostOnly(input, testName);

const expected =
  'echo:ping\n' +
  'hasFilename:true\n' +
  'hasDirname:true\n' +
  'hasProcessPkg:true\n' +
  'helperResult:hello world\n';

utils.assertSeaOutput(testName, expected);

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
