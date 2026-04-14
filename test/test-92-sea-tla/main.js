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

utils.assertSeaOutput('test-92-sea-tla', 'before-tla\nafter-tla:42\n');

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
