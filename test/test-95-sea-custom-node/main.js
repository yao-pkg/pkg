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
const expected = 'custom-node SEA OK:true\n';

// Both forms supply a custom base Node binary instead of downloading one. We
// use the host's own node (process.execPath) so the embedded runtime matches
// the single `host` target's platform/arch/major (required by the guard in
// lib/sea.ts). runSeaHostOnly builds for `host` only — a single target.

// 1. Explicit --sea-node-path flag (exercises the exists() + `node --version`
//    branch in getNodejsExecutable / the version guard).
{
  const testName = 'test-95-sea-custom-node';
  const newcomers = utils.seaHostOutputs(testName);
  const before = utils.filesBefore(newcomers);
  utils.runSeaHostOnly(input, testName, ['--sea-node-path', process.execPath]);
  utils.assertSeaOutput(testName, expected);
  utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
}

// 2. PKG_NODE_PATH env var (exercises the env fallback folded into SEA). pkg
//    runs in a child process that inherits this env.
{
  const testName = 'test-95-sea-custom-node-env';
  const newcomers = utils.seaHostOutputs(testName);
  const before = utils.filesBefore(newcomers);
  process.env.PKG_NODE_PATH = process.execPath;
  try {
    utils.runSeaHostOnly(input, testName);
  } finally {
    delete process.env.PKG_NODE_PATH;
  }
  utils.assertSeaOutput(testName, expected);
  utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
}
