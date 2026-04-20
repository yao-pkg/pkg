#!/usr/bin/env node

'use strict';

const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

// Both package.json#pkg (win target) and .pkgrc (linux/macos) are present.
// The .pkgrc takes precedence, so we should see linux + macos outputs only.
const input = './package.json';

const newcomers = ['palookaville-linux', 'palookaville-macos'];

const before = utils.filesBefore(newcomers);

utils.pkg.sync([input], { stdio: 'inherit' });

utils.filesAfter(before, newcomers);
