#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const utils = require('../utils.js');

assert(__dirname === process.cwd());

// Hooks are most thoroughly exercised through the programmatic Node.js API
// (function-form preBuild/postBuild/transform aren't reachable from the CLI).
// We require the built lib-es5 entry point directly — same entry point
// `utils.pkg.sync` shells out to.
const es5 = path.resolve(__dirname, '../../lib-es5/index.js');
assert(fs.existsSync(es5), 'Run `yarn build` first!');
const pkg = require(es5);

const target = process.argv[2] || 'host';
const ext = process.platform === 'win32' ? '.exe' : '';
const output = `test-46-hooks-out${ext}`;
const preMarker = path.resolve(__dirname, 'pre-marker.txt');
const newcomers = [output, 'pre-marker.txt'];

const before = utils.filesBefore(newcomers);

let preCalls = 0;
let postCalls = 0;
let postOutput = null;
let transformedFiles = [];

(async () => {
  await pkg.exec({
    input: path.resolve(__dirname, 'index.js'),
    targets: [target],
    output: path.resolve(__dirname, output),
    debug: false,
    // Shell preBuild: writes a sentinel file we can detect afterwards.
    preBuild:
      process.platform === 'win32'
        ? `cmd /c "echo ran > pre-marker.txt"`
        : `echo ran > pre-marker.txt`,
    // Function preBuild would also work; we want to cover both forms in one
    // run, so wrap the shell hook with a function that asserts ordering.
    // Here we keep preBuild as the shell form and use postBuild as fn.
    postBuild: (out) => {
      postCalls++;
      postOutput = out;
    },
    transform: (file, contents) => {
      transformedFiles.push(file);
      const text = contents.toString();
      if (text.includes('PKG_HOOKS_MARKER')) {
        return text.replace(/PKG_HOOKS_MARKER/g, 'PKG_HOOKS_MUTATED');
      }
      return undefined; // leave non-target files untouched
    },
  });
  preCalls = fs.existsSync(preMarker) ? 1 : 0;

  // 1) preBuild ran
  assert.equal(preCalls, 1, 'preBuild shell hook did not run');

  // 2) postBuild ran exactly once with the target output path
  assert.equal(postCalls, 1, 'postBuild ran ' + postCalls + ' times');
  assert.equal(
    postOutput,
    path.resolve(__dirname, output),
    'postBuild output path mismatch: ' + postOutput,
  );

  // 3) transform was invoked for the entrypoint at least
  assert.ok(
    transformedFiles.some((f) => f.endsWith('index.js')),
    'transform never saw index.js: ' + transformedFiles.join(','),
  );

  // 4) the produced binary actually prints the transformed marker — proves
  // the transform mutation flowed all the way into the bundle.
  const stdout = execFileSync(path.resolve(__dirname, output), {
    encoding: 'utf8',
  });
  assert.ok(
    stdout.includes('PKG_HOOKS_MUTATED'),
    'binary did not print the transformed marker; stdout=' + stdout,
  );
  assert.ok(
    !stdout.includes('PKG_HOOKS_MARKER'),
    'original marker leaked through transform; stdout=' + stdout,
  );

  utils.filesAfter(before, newcomers);
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
