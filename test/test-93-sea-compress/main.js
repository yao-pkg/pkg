#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const utils = require('../utils.js');

// Enhanced SEA requires Node.js >= 22
if (utils.getNodeMajorVersion() < 22) {
  return;
}

assert(__dirname === process.cwd());

// Load the committed payload (compressible 100 KB fixture).  A regression in
// the compression path that accidentally shipped raw-or-truncated bytes would
// surface from the length + head + stat assertions below.
const PAYLOAD = fs.readFileSync(path.join(__dirname, 'payload.txt'), 'utf8');

// Build the same fixture with every supported compressor (+ none) and assert
// each packaged binary produces identical output.  --compress Zstd needs
// Node.js >= 22.15 at build time; skip if the runtime we are testing under
// cannot produce it.
const input = './package.json';
const codecs = ['None', 'Brotli', 'GZip'];
if (typeof zlib.zstdCompressSync === 'function') {
  codecs.push('Zstd');
}

const platformSuffix = { linux: 'linux', darwin: 'macos', win32: 'win.exe' };
const suffix = platformSuffix[process.platform];
if (!suffix) {
  console.log('  Skipping: unsupported platform ' + process.platform);
  return;
}

const expected =
  'len=' +
  PAYLOAD.length +
  '\nhead=' +
  PAYLOAD.slice(0, 32) +
  '\nstat=' +
  PAYLOAD.length +
  '\n';

const newcomers = codecs.map(
  (codec) => 'test-93-sea-compress-' + codec.toLowerCase() + '-' + suffix,
);

const before = utils.filesBefore(newcomers);

const sizes = {};

for (let i = 0; i < codecs.length; i += 1) {
  const codec = codecs[i];
  const output = newcomers[i];
  const args = [input, '--sea', '-o', output];
  if (codec !== 'None') {
    args.push('--compress', codec);
  }
  utils.pkg.sync(args, { stdio: 'inherit' });
  const actual = utils.spawn.sync('./' + output, []).replace(/\r\n/g, '\n');
  assert.equal(
    actual,
    expected,
    'Output for codec ' + codec + ' did not match expected',
  );
  sizes[codec] = fs.statSync(output).size;
}

// Regression guard: if any codec silently fell back to None, this catches it.
// The payload is a highly repetitive 100 KB fixture — every lossless codec
// must shrink it by at least ~50 KB vs. the None build, a margin that swamps
// any bootstrap / SEA-overhead noise.
const MIN_SAVINGS_BYTES = 50 * 1024;
const noneSize = sizes.None;
for (const codec of codecs) {
  if (codec === 'None') continue;
  const savings = noneSize - sizes[codec];
  assert(
    savings >= MIN_SAVINGS_BYTES,
    'Codec ' +
      codec +
      ' only saved ' +
      savings +
      ' bytes vs. None (' +
      sizes[codec] +
      ' vs ' +
      noneSize +
      '); suspected silent fallback to uncompressed.',
  );
}

utils.filesAfter(before, newcomers, { tolerateWindowsEbusy: true });
