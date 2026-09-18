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

// readlink on a path that exists but is not a link is EINVAL, not ENOENT —
// in both modes now (#296).
const notALink = path.join(__dirname, 'index.js');
assert.throws(() => fs.readlinkSync(notALink), { code: 'EINVAL' });

// ...and the error names the path the caller asked about, not the internal
// mount-relative key the SEA provider works in.
try {
  fs.readlinkSync(notALink);
} catch (err) {
  assert.strictEqual(err.path, notALink, 'EINVAL must name the caller path');
}

// readlink honours its encoding option in both modes.
if (nestedIsLink) {
  const asBuffer = fs.readlinkSync(nested, 'buffer');
  assert.ok(Buffer.isBuffer(asBuffer), "readlink 'buffer' must give a Buffer");
  assert.strictEqual(
    asBuffer.toString(),
    fs.readlinkSync(nested),
    'the buffer and string forms must agree',
  );
  assert.ok(
    Buffer.isBuffer(fs.readlinkSync(nested, { encoding: 'buffer' })),
    'the { encoding } form must work too',
  );
}

// readdir must return a usable listing in both modes. SEA builds its listing
// from manifest.directories, which holds only the paths the walker recorded,
// so which entries appear there is not asserted — only that it works at all.
const dirents = fs.readdirSync(__dirname, { withFileTypes: true });
assert.ok(
  Array.isArray(dirents) && dirents.length > 0,
  'readdir returned nothing',
);

// readdir is lstat-based, so a link reports as a link rather than as the
// directory it points at — same as outside a packaged binary — and lstat must
// agree with the dirent. Both modes answer from their own symlink record
// since #296, so this is asserted for both.
{
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

// path.join(d.parentPath, d.name) is the documented way to use withFileTypes,
// and what `recursive: true` consumers do. Undefined here throws.
for (const d of dirents) {
  assert.strictEqual(
    typeof d.parentPath,
    'string',
    `dirent ${d.name} is missing parentPath`,
  );
  assert.ok(fs.existsSync(path.join(d.parentPath, d.name)));
}

// readdir *of the linked directory*: manifest.symlinks is keyed by the
// unresolved path, so resolving `lib` first and then looking entries up under
// `reallib` would silently report the nested link as a plain file.
const libDirents = fs.readdirSync(path.join(__dirname, 'lib'), {
  withFileTypes: true,
});
const innerEntry = libDirents.find((e) => e.name === 'inner.js');
assert.ok(innerEntry, 'inner.js missing from readdir of the linked directory');
assert.strictEqual(innerEntry.isSymbolicLink(), nestedIsLink);

// The manifest records are read with a bracket index, so a key inherited from
// Object.prototype must not read as a packaged file in either mode.
for (const inherited of ['constructor', 'toString', '__proto__']) {
  assert.strictEqual(
    fs.existsSync(path.join(__dirname, inherited)),
    false,
    `${inherited} must not report as an existing snapshot file`,
  );
}

// The callback and promise forms go through separate patches in both modes,
// and nothing exercised them before — which is how two ELOOP bugs reached the
// third review round. Run them before handing back to the harness.
const pending = [];

if (nestedIsLink) {
  pending.push(
    new Promise((resolve, reject) => {
      fs.readlink(nested, (err, target) => {
        if (err) return reject(err);
        try {
          assert.strictEqual(path.basename(target), 'log.js');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }),
    fs.promises
      .readlink(nested)
      .then((t) => assert.strictEqual(path.basename(t), 'log.js')),
  );
}

pending.push(
  new Promise((resolve, reject) => {
    fs.lstat(path.join(__dirname, 'lib'), (err, st) => {
      if (err) return reject(err);
      try {
        assert.strictEqual(st.isSymbolicLink(), true);
        assert.strictEqual(st.isDirectory(), false);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }),
  fs.promises
    .lstat(path.join(__dirname, 'lib'))
    .then((st) => assert.strictEqual(st.isSymbolicLink(), true)),
  new Promise((resolve, reject) => {
    fs.readdir(__dirname, { withFileTypes: true }, (err, list) => {
      if (err) return reject(err);
      try {
        const lib = list.find((e) => e.name === 'lib');
        assert.ok(lib, 'lib missing from async readdir');
        assert.strictEqual(lib.isSymbolicLink(), true);
        assert.strictEqual(typeof lib.parentPath, 'string');
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }),
  // readlink on a non-link must reach the callback as an error, never throw.
  new Promise((resolve, reject) => {
    let threw = false;
    try {
      fs.readlink(notALink, (err) => {
        try {
          assert.ok(err, 'async readlink on a non-link must report an error');
          assert.strictEqual(err.code, 'EINVAL');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    } catch {
      threw = true;
    }
    if (threw) reject(new Error('fs.readlink threw synchronously'));
  }),
);

Promise.all(pending).then(
  () => log(42),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
