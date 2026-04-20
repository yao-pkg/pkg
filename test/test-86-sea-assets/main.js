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
const testName = 'test-86-sea-assets';

const newcomers = utils.seaHostOutputs(testName);

const before = utils.filesBefore(newcomers);

utils.runSeaHostOnly(input, testName);

utils.assertSeaOutput(testName, 'config:test-value\ndata:hello world\n');

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
