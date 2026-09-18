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

// ...and it must answer in the platform's own path form. SEA mounts the VFS
// under a POSIX '/snapshot' prefix, so on Windows the resolved path has to be
// converted back to `C:\snapshot\...` before it leaves fs (yao-pkg/pkg#305).
// A non-link round-trips to itself, which makes this a no-op off Windows.
assert.strictEqual(
  fs.realpathSync(__filename),
  __filename,
  'realpath must round-trip a non-link in the platform path form',
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
const notALink = path.join(__dirname, 'index.js');
if (!isSea) {
  assert.throws(() => fs.readlinkSync(notALink), { code: 'EINVAL' });
} else {
  // Asserted rather than skipped: SEA's current answer is the resolved path,
  // and pinning it here means the day the provider gains real link semantics
  // this test says so instead of quietly agreeing with both contracts.
  assert.strictEqual(fs.readlinkSync(notALink), notALink);
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

  // The type bits have to agree with the predicate: consumers that sniff
  // `mode & S_IFMT` (tar, archiver, fs.cp) read those, not isSymbolicLink().
  const S_IFMT = 0o170000;
  const S_IFLNK = 0o120000;
  assert.strictEqual(fs.lstatSync(libPath).mode & S_IFMT, S_IFLNK);
}

// The manifest records are read with a bracket index, so a key inherited from
// Object.prototype must not read as a packaged file in either mode.
for (const inherited of ['constructor', 'toString', '__proto__']) {
  assert.strictEqual(
    fs.existsSync(path.join(__dirname, inherited)),
    false,
    `${inherited} must not report as an existing snapshot file`,
  );
}

log(42);
