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

// Both modes answer readlink now: SEA by way of realpath through the VFS
// polyfill, classic from the SYMLINKS record (#296).
if (nestedIsLink) {
  assert.strictEqual(path.basename(fs.readlinkSync(nested)), 'log.js');
}

// readlink on a path that exists but is not a link is EINVAL, not ENOENT.
// Classic mode only: in SEA mode the VFS polyfill answers readlink through
// realpathSync without ever consulting the provider, so a non-link returns a
// resolved path instead of throwing (yao-pkg/pkg#299, upstream routing).
if (!isSea) {
  assert.throws(() => fs.readlinkSync(path.join(__dirname, 'index.js')), {
    code: 'EINVAL',
  });
}

// readdir must return a usable listing in both modes. SEA builds its listing
// from manifest.directories, which holds only the paths the walker recorded,
// so which entries appear there is not asserted — only that it works at all.
const dirents = fs.readdirSync(__dirname, { withFileTypes: true });
assert.ok(
  Array.isArray(dirents) && dirents.length > 0,
  'readdir returned nothing',
);

// Classic-mode readdir is lstat-based, so a link reports as a link rather
// than as the directory it points at — same as it does outside a packaged
// binary — and lstat must agree with the dirent. The SEA provider builds its
// listing from manifest.directories, which holds resolved paths only, so it
// does not surface link entries at all.
if (!isSea) {
  const libEntry = dirents.find((e) => e.name === 'lib');
  assert.ok(libEntry, 'lib missing from readdir');
  assert.strictEqual(libEntry.isSymbolicLink(), true);
  assert.strictEqual(libEntry.isDirectory(), false);
  const reallibEntry = dirents.find((e) => e.name === 'reallib');
  assert.ok(reallibEntry, 'reallib missing from readdir');
  assert.strictEqual(reallibEntry.isSymbolicLink(), false);
  assert.strictEqual(reallibEntry.isDirectory(), true);

  // lstat describes the link itself; stat follows it. readdir and lstat must
  // not contradict each other about the same entry.
  const libPath = path.join(__dirname, 'lib');
  assert.strictEqual(fs.lstatSync(libPath).isSymbolicLink(), true);
  assert.strictEqual(fs.lstatSync(libPath).isDirectory(), false);
  assert.strictEqual(fs.statSync(libPath).isDirectory(), true);
  assert.strictEqual(fs.statSync(libPath).isSymbolicLink(), false);

  // readlink round-trips the directory link too.
  assert.strictEqual(path.basename(fs.readlinkSync(libPath)), 'reallib');
}

log(42);
