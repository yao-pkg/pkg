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
const testName = 'test-94-sea-esm-import-meta';

const SEA_PLATFORM_SUFFIX = {
  linux: 'linux',
  darwin: 'macos',
  win32: 'win.exe',
};
const suffix = SEA_PLATFORM_SUFFIX[process.platform];

const newcomers = utils.seaHostOutputs(testName);
const before = utils.filesBefore(newcomers);

// Capture pkg's output so we can assert the Babel parse warning (issue #264)
// never surfaces when walking ESM files that use `import.meta`.
const args = suffix
  ? [input, '--sea', '--target', 'host', '--output', `${testName}-${suffix}`]
  : [input, '--sea'];

const build = utils.pkg.sync(args, { stdio: ['pipe', 'pipe', 'pipe'] });
const buildLog = build.stdout + build.stderr;

assert(
  buildLog.indexOf('Babel parse has failed') === -1,
  'pkg must parse ESM files as modules (issue #264)\npkg output was:\n' +
    buildLog,
);

// A successful parse means both imports were walked and bundled — running the
// binary proves it by printing the imported values. Skip on unsupported hosts.
if (suffix) {
  utils.assertSeaOutput(
    testName,
    'here:index.mjs\nstatic:hello world\ndynamic:HELLO WORLD\n',
  );
}

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
