#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

// Enhanced SEA requires Node.js >= 22
if (utils.getNodeMajorVersion() < 22) {
  return;
}

assert(__dirname === process.cwd());

const input = './app/package.json';
const testName = 'test-91-sea-esm-entry';

const newcomers = utils.seaHostOutputs(testName);

const before = utils.filesBefore(newcomers);

utils.runSeaHostOnly(input, testName);

utils.assertSeaOutput(testName, 'add:5\ngreet:hello world\n');

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
