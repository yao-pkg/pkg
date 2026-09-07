'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const log = require('./lib/log');

// `lib` links to `reallib`, and `reallib/inner.js` links to `log.js` inside
// it. The walker records both, so this path has its own manifest entry that
// must win over its symlinked parent.
require('./lib/inner.js');

// Windows can refuse to create the nested *file* link, in which case main.js
// leaves a plain copy in its place. The directory link is a real junction
// there, so the parent walk is covered either way.
const { nestedIsLink } = require('./linkinfo.json');

let isSea = false;
try {
  isSea = require('node:sea').isSea();
} catch {
  isSea = false;
}

const nested = path.join(__dirname, 'lib', 'inner.js');

// realpath must follow the chain rather than throwing ENOENT.
assert.strictEqual(
  path.basename(fs.realpathSync(nested)),
  nestedIsLink ? 'log.js' : 'inner.js',
);
assert.strictEqual(
  path.basename(fs.realpathSync(path.join(__dirname, 'lib', 'log.js'))),
  'log.js',
);

// The VFS answers readlink by way of realpath, so this only holds in SEA
// mode — the classic bootstrap does not patch fs.readlinkSync at all.
if (isSea && nestedIsLink) {
  assert.strictEqual(path.basename(fs.readlinkSync(nested)), 'log.js');
}

// Classic-mode readdir is lstat-based, so a link reports as a link rather
// than as the directory it points at — same as it does outside a packaged
// binary. The SEA provider builds its listing from manifest.directories,
// which holds resolved paths only, so it does not surface link entries at
// all; that gap is tracked separately.
if (!isSea) {
  const dirents = fs.readdirSync(__dirname, { withFileTypes: true });
  const libEntry = dirents.find((e) => e.name === 'lib');
  assert.ok(libEntry, 'lib missing from readdir');
  assert.strictEqual(libEntry.isSymbolicLink(), true);
  assert.strictEqual(libEntry.isDirectory(), false);
  const reallibEntry = dirents.find((e) => e.name === 'reallib');
  assert.ok(reallibEntry, 'reallib missing from readdir');
  assert.strictEqual(reallibEntry.isSymbolicLink(), false);
  assert.strictEqual(reallibEntry.isDirectory(), true);
}

log(42);
