#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const utils = require('../utils.js');

// The transform hook only runs in the *enhanced* SEA pipeline (a package.json
// input, which goes through the walker). Enhanced SEA requires Node.js >= 22.
if (utils.getNodeMajorVersion() < 22) {
  return;
}

assert(!module.parent);
assert(__dirname === process.cwd());

// `transform` is function-only (not reachable from the CLI), so drive the
// programmatic API directly — the same lib-es5 entry point `utils.pkg.sync`
// shells out to.
const es5 = path.resolve(__dirname, '../../lib-es5/index.js');
assert(fs.existsSync(es5), 'Run `yarn build` first!');
const pkg = require(es5);

const testName = 'test-88-sea-hooks';
const newcomers = utils.seaHostOutputs(testName);
const before = utils.filesBefore(newcomers);

const transformedFiles = [];

const transform = (file, contents) => {
  transformedFiles.push(file);
  const text = contents.toString();
  if (text.includes('PKG_SEA_HOOK_MARKER')) {
    return text.replace(/PKG_SEA_HOOK_MARKER/g, 'PKG_SEA_HOOK_MUTATED');
  }
  return undefined; // leave non-target files untouched
};

(async () => {
  const baseOptions = {
    input: path.resolve(__dirname, 'package.json'),
    sea: true,
    transform,
  };

  // Build only the host binary on the platforms pkg ships SEA for (the one we
  // actually run); fall back to the default multi-target build elsewhere.
  // Mirrors utils.runSeaHostOnly, but through the programmatic API because the
  // transform hook can't be passed on the CLI.
  if (newcomers.length === 1) {
    await pkg.exec({
      ...baseOptions,
      targets: ['host'],
      output: path.resolve(__dirname, newcomers[0]),
    });
  } else {
    await pkg.exec(baseOptions);
  }

  // 1) transform saw the entry script.
  assert.ok(
    transformedFiles.some((f) => f.endsWith('index.js')),
    'transform never saw index.js: ' + transformedFiles.join(','),
  );

  // 2) the produced SEA binary prints the transformed marker — proves the
  // transform mutation flowed all the way into the SEA archive bytes.
  utils.assertSeaOutput(testName, 'PKG_SEA_HOOK_MUTATED\n');

  utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
