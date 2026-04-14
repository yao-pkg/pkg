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

const newcomers = [
  'test-92-sea-tla-linux',
  'test-92-sea-tla-macos',
  'test-92-sea-tla-win.exe',
];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input, '--sea'], { stdio: 'inherit' });

const expected = 'before-tla\nafter-tla:42\n';

const platformSuffix = { linux: 'linux', darwin: 'macos', win32: 'win.exe' };
const suffix = platformSuffix[process.platform];
if (suffix) {
  const actual = utils.spawn
    .sync(`./test-92-sea-tla-${suffix}`, [])
    .replace(/\r\n/g, '\n');
  assert.equal(actual, expected, 'Output matches');
}

try {
  utils.filesAfter(before, newcomers);
} catch (_error) {
  // noop
}
