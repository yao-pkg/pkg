#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const zlib = require('zlib');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

/* eslint-disable no-unused-vars */
const input = 'test-x.js';
const target = 'host';
const ext = process.platform === 'win32' ? '.exe' : '';
const outputRef = 'output-empty' + ext;
const outputNone = 'output-None' + ext;
const outputGZip = 'output-Brotli' + ext;
const outputBrotli = 'output-GZip' + ext;
const outputZstd = 'output-Zstd' + ext;
const outputBrotliDebug = 'output-debug' + ext;
// Zstd zlib bindings landed in Node 22.15 — skip if the build host lacks them.
const zstdAvailable = typeof zlib.createZstdCompress === 'function';

const inspect = ['ignore', 'ignore', 'pipe'];

console.log(' compiling empty ');
const logPkg0 = utils.pkg.sync(
  [
    '--target',
    target,
    '--compress',
    'None',
    '--output',
    outputRef,
    './test-empty.js',
  ],
  { expect: 0 },
);
const sizeReference = fs.statSync(outputRef).size;

function pkgCompress(compressMode, output) {
  console.log(` compiling compression ${compressMode} `);
  const logPkg1 = utils.pkg.sync(
    ['--target', target, '--compress', compressMode, '--output', output, input],
    { stdio: inspect, expect: 0 },
  );
  // check that produced executable is running and produce the expected output.
  const log = utils.spawn.sync(path.join(__dirname, output), [], {
    cwd: __dirname,
    expect: 0,
  });
  assert(log === '42\n');
  return fs.statSync(output).size;
}

const sizeNoneFull = pkgCompress('None', outputNone);
const sizeGZipFull = pkgCompress('GZip', outputGZip);
const sizeBrotliFull = pkgCompress('Brotli', outputBrotli);
const sizeZstdFull = zstdAvailable ? pkgCompress('Zstd', outputZstd) : null;

const sizeNone = sizeNoneFull - sizeReference;
const sizeBrotli = sizeBrotliFull - sizeReference;
const sizeGZip = sizeGZipFull - sizeReference;
const sizeZstd = sizeZstdFull !== null ? sizeZstdFull - sizeReference : null;

console.log(' compiling compression Brotli + debug');
const logPkg4 = utils.pkg.sync(
  [
    '--target',
    target,
    '--debug',
    '--compress',
    'Brotli',
    '--output',
    outputBrotliDebug,
    input,
  ],
  { expect: 0 },
);

console.log('node.exe size  =', sizeReference);
console.log('virtual file system');
console.log('No compression =  ', sizeNone - sizeReference);
console.log(
  '        Δ GZip = ',
  sizeGZip - sizeNone,
  '(',
  (((sizeGZip - sizeNone) / sizeNone) * 100).toFixed(0),
  '%)',
);
console.log(
  '      Δ Brotli = ',
  sizeBrotli - sizeNone,
  '(',
  (((sizeBrotli - sizeNone) / sizeNone) * 100).toFixed(0),
  '%)',
);
if (sizeZstd !== null) {
  console.log(
    '        Δ Zstd = ',
    sizeZstd - sizeNone,
    '(',
    (((sizeZstd - sizeNone) / sizeNone) * 100).toFixed(0),
    '%)',
  );
}

assert(sizeNone > sizeGZip);
assert(sizeGZip > sizeBrotli);
if (sizeZstd !== null) {
  // Zstd must shrink the payload vs. the uncompressed build — catches a
  // silent fallback in the Standard-pipeline Zstd branch.
  assert(sizeNone > sizeZstd);
}

const logPkg5 = utils.pkg.sync(
  ['--target', target, '--compress', 'Crap', '--output', outputBrotli, input],
  { expect: 2 },
);

// xx console.log(logPkg4);
assert(logPkg5.match(/Invalid compression algorithm/g));

utils.vacuum.sync(outputRef);
utils.vacuum.sync(outputNone);
utils.vacuum.sync(outputBrotli);
utils.vacuum.sync(outputGZip);
if (zstdAvailable) {
  utils.vacuum.sync(outputZstd);
}
utils.vacuum.sync(outputBrotliDebug);
