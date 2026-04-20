#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

// Input is a plain JS file — .pkgrc in the same directory should be
// auto-discovered and drive the targets.
const input = './test-x-index.js';

const newcomers = ['test-x-index-linux', 'test-x-index-macos'];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input], { stdio: 'inherit' });

utils.filesAfter(before, newcomers);
