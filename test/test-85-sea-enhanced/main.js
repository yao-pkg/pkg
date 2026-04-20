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
const testName = 'test-85-sea-enhanced';

const newcomers = utils.seaHostOutputs(testName);

const before = utils.filesBefore(newcomers);

utils.runSeaHostOnly(input, testName);

const expected =
  'hello from lib\n' +
  'main: got message\n' +
  'pkg-exists:true\n' +
  'pkg-entrypoint:true\n' +
  'pkg-path-resolve:true\n' +
  'pkg-mount:throws\n';

utils.assertSeaOutput(testName, expected);

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
