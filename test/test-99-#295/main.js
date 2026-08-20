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

const newcomers = utils.seaHostOutputs(testName);

const before = utils.filesBefore(newcomers);

utils.runSeaHostOnly(input, testName);

const expectedOutput = '42\n';

utils.assertSeaOutput(testName, expectedOutput);

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
