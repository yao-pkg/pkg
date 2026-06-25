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
const testName = 'test-95-sea-local-node';

const newcomers = utils.seaHostOutputs(testName);

const before = utils.filesBefore(newcomers);

// `--sea-use-local-node` embeds the Node binary running pkg as the SEA base
// instead of downloading one. Exercises the base-node override end to end (and,
// on Node >= 25.5 hosts, the in-core `--build-sea` injection path).
utils.runSeaHostOnly(input, testName, ['--sea-use-local-node']);

utils.assertSeaOutput(testName, 'local-node SEA OK:true\n');

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
