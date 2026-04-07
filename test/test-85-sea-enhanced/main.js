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

const newcomers = [
  'test-85-sea-enhanced-linux',
  'test-85-sea-enhanced-macos',
  'test-85-sea-enhanced-win.exe',
];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input, '--sea'], { stdio: 'inherit' });

if (process.platform === 'linux') {
  assert.equal(
    utils.spawn.sync('./test-85-sea-enhanced-linux', []),
    'hello from lib\nmain: got message\n',
    'Output matches',
  );
} else if (process.platform === 'darwin') {
  assert.equal(
    utils.spawn.sync('./test-85-sea-enhanced-macos', []),
    'hello from lib\nmain: got message\n',
    'Output matches',
  );
} else if (process.platform === 'win32') {
  assert.equal(
    utils.spawn.sync('./test-85-sea-enhanced-win.exe', []),
    'hello from lib\nmain: got message\n',
    'Output matches',
  );
}

try {
  utils.filesAfter(before, newcomers);
} catch (_error) {
  // noop — Windows EBUSY workaround
}
