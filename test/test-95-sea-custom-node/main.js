#!/usr/bin/env node

'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
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

// 3. Unhappy paths — the guard rejects a custom base binary that can't satisfy
// the requested target(s). These error before any build (no output produced),
// so they're fast and host-independent. We feed the host's own node and pick
// targets it provably can't be.
const M = utils.getNodeMajorVersion();
const hostPlatform =
  process.platform === 'darwin'
    ? 'macos'
    : process.platform === 'win32'
      ? 'win'
      : 'linux';
const hostArch = process.arch; // 'x64' | 'arm64'
// The guard runs the supplied node and compares its reported process.platform
// to the target. We feed the host's own node (process.execPath, which the guard
// reads without exec'ing it — see probeNode), so any non-host OS target
// mismatches. Pick a platform that isn't the host's — covers macOS, Linux, and
// Windows hosts. (Deliberately not alpine/linuxstatic: those report
// process.platform 'linux' like a Linux host, so they wouldn't be a mismatch.)
const otherPlatform = hostPlatform === 'macos' ? 'linux' : 'macos';
const otherMajor = M === 22 ? 20 : 22;
const out = path.join(os.tmpdir(), 'pkg-sea-guard-out');

function expectGuardError(targets, re, label) {
  const r = utils.pkg.sync(
    [
      input,
      '--sea',
      '--sea-node-path',
      process.execPath,
      '--targets',
      targets,
      '--output',
      out,
    ],
    { stdio: 'pipe', expect: 2 },
  );
  assert(
    re.test(r.stdout + r.stderr),
    `${label}: expected /${re.source}/, got:\n${r.stdout}\n${r.stderr}`,
  );
}

// a) Multiple distinct platform/arch targets — one binary can't be all of them.
expectGuardError(
  `node${M}-linux-x64,node${M}-macos-arm64`,
  /single platform\/arch|span \d/i,
  'multi platform/arch',
);

// b) Multiple mutually-exclusive Linux flavors (glibc vs musl) — same guard.
expectGuardError(
  `node${M}-linux-x64,node${M}-alpine-x64`,
  /single platform\/arch|span \d/i,
  'multi linux flavor',
);

// c) Single target, wrong platform: the binary reports a process.platform that
//    can't match a different-OS target (e.g. a darwin node for a linux target).
expectGuardError(
  `node${M}-${otherPlatform}-${hostArch}`,
  /is for "\w+", but target|needs "\w+"/i,
  'platform mismatch',
);

// d) Single target, right platform but wrong major.
expectGuardError(
  `node${otherMajor}-${hostPlatform}-${hostArch}`,
  /major version must match|requests Node/i,
  'major mismatch',
);
