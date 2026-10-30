'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const log = require('./lib/log');

// `lib` links to `reallib`, and `reallib/inner.js` links to `log.js` inside
// it. The walker records both, so this path has its own manifest entry that
// must win over its symlinked parent.
require('./lib/inner.js');

// `reallib/other.js` links to `log.js` too but is only required through the
// real directory, so the walker records it under `reallib/` and never `lib/`.
require('./reallib/other.js');

// Windows can refuse to create the nested *file* link, in which case main.js
// leaves a plain copy in its place. The directory link is a real junction
// there, so the parent walk is covered either way.
const { nestedIsLink } = require('./linkinfo.json');

const nested = path.join(__dirname, 'lib', 'inner.js');

// realpath must follow the chain rather than throwing ENOENT.
assert.strictEqual(
  path.basename(fs.realpathSync(nested)),
  nestedIsLink ? 'log.js' : 'inner.js',
  `realpath of the nested link (nestedIsLink=${nestedIsLink})`,
);
assert.strictEqual(
  path.basename(fs.realpathSync(path.join(__dirname, 'lib', 'log.js'))),
  'log.js',
  'realpath through the linked directory',
);

// ...in the platform's path form, `C:\snapshot\...` on Windows (#305).
assert.strictEqual(
  fs.realpathSync(__filename),
  __filename,
  'realpath must round-trip a non-link in the platform path form',
);

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const libPath = path.join(__dirname, 'lib');
const realLib = path.join(__dirname, 'reallib');
const viaParent = path.join(libPath, 'other.js');
const notALink = path.join(__dirname, 'index.js');

// readlink answers the walker's absolute target, in the platform path form.
assert.strictEqual(
  fs.readlinkSync(libPath),
  realLib,
  'readlink of the directory link',
);
const asBuffer = fs.readlinkSync(libPath, 'buffer');
assert.ok(Buffer.isBuffer(asBuffer), "readlink 'buffer' must give a Buffer");
assert.strictEqual(asBuffer.toString(), realLib);
assert.ok(Buffer.isBuffer(fs.readlinkSync(libPath, { encoding: 'buffer' })));
// Encoded after the mount prefix is added, so it decodes to the full path.
assert.strictEqual(
  Buffer.from(fs.readlinkSync(libPath, 'hex'), 'hex').toString(),
  realLib,
  "readlink 'hex'",
);
if (nestedIsLink) {
  const logPath = path.join(__dirname, 'reallib', 'log.js');
  assert.strictEqual(fs.readlinkSync(nested), logPath, 'readlink nested');
  assert.strictEqual(
    fs.readlinkSync(viaParent),
    logPath,
    'readlink via parent',
  );
}

// EINVAL for a path that exists but is not a link, ENOENT for one that does
// not exist, and both name the caller's path.
assert.throws(() => fs.readlinkSync(notALink), {
  code: 'EINVAL',
  path: notALink,
});
assert.throws(() => fs.readlinkSync(realLib), {
  code: 'EINVAL',
  path: realLib,
});
// A plain file reached through the linked directory is not a link.
const logViaLink = path.join(libPath, 'log.js');
assert.throws(() => fs.readlinkSync(logViaLink), {
  code: 'EINVAL',
  path: logViaLink,
});
assert.strictEqual(fs.lstatSync(logViaLink).isSymbolicLink(), false);
assert.strictEqual(fs.lstatSync(logViaLink).isFile(), true);
const missing = path.join(__dirname, 'missing.js');
assert.throws(() => fs.readlinkSync(missing), {
  code: 'ENOENT',
  path: missing,
});
assert.throws(() => fs.lstatSync(missing), { code: 'ENOENT', path: missing });

// lstat describes a link itself, stat follows it, and a non-link is unchanged.
function assertLink(p, isDir) {
  const l = fs.lstatSync(p);
  assert.strictEqual(l.isSymbolicLink(), true, `lstat ${p} isSymbolicLink`);
  assert.strictEqual(l.isDirectory(), false, `lstat ${p} isDirectory`);
  assert.strictEqual(l.isFile(), false, `lstat ${p} isFile`);
  assert.strictEqual(l.mode & S_IFMT, S_IFLNK, `lstat ${p} type bits`);
  const s = fs.statSync(p);
  assert.strictEqual(s.isSymbolicLink(), false, `stat ${p} isSymbolicLink`);
  assert.strictEqual(s.isDirectory(), isDir, `stat ${p} isDirectory`);
}
assertLink(libPath, true);
if (nestedIsLink) {
  assertLink(nested, false);
  assertLink(viaParent, false);
}
assert.strictEqual(fs.lstatSync(notALink).isSymbolicLink(), false);
assert.strictEqual(fs.lstatSync(notALink).isFile(), true);
assert.strictEqual(fs.lstatSync(realLib).isDirectory(), true);

// readdir reports links as links and agrees with lstat.
function direntOf(dir, name) {
  const d = fs
    .readdirSync(dir, { withFileTypes: true })
    .find((e) => e.name === name);
  assert.ok(d, `${name} missing from readdir of ${dir}`);
  assert.strictEqual(d.parentPath, dir, `${name} parentPath`);
  return d;
}
assert.strictEqual(direntOf(__dirname, 'lib').isSymbolicLink(), true);
assert.strictEqual(direntOf(__dirname, 'reallib').isDirectory(), true);
assert.strictEqual(
  direntOf(libPath, 'inner.js').isSymbolicLink(),
  nestedIsLink,
  'readdir of the linked directory',
);
assert.strictEqual(
  direntOf(libPath, 'other.js').isSymbolicLink(),
  nestedIsLink,
  'readdir finds a link recorded under the real parent',
);

// The callback and promise forms go through separate patches.
function viaCallback(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, value) => (err ? reject(err) : resolve(value)));
  });
}

const pending = [
  viaCallback(fs.lstat, libPath).then((st) =>
    assert.strictEqual(st.isSymbolicLink(), true, 'fs.lstat'),
  ),
  fs.promises
    .lstat(libPath)
    .then((st) =>
      assert.strictEqual(st.isSymbolicLink(), true, 'fs.promises.lstat'),
    ),
  viaCallback(fs.readdir, __dirname, { withFileTypes: true }).then((list) =>
    assert.strictEqual(
      list.find((e) => e.name === 'lib').isSymbolicLink(),
      true,
      'fs.readdir withFileTypes',
    ),
  ),
  fs.promises
    .readdir(__dirname, { withFileTypes: true })
    .then((list) =>
      assert.strictEqual(
        list.find((e) => e.name === 'lib').isSymbolicLink(),
        true,
        'fs.promises.readdir withFileTypes',
      ),
    ),
  viaCallback(fs.readlink, libPath).then((t) =>
    assert.strictEqual(t, realLib, 'fs.readlink'),
  ),
  fs.promises
    .readlink(libPath)
    .then((t) => assert.strictEqual(t, realLib, 'fs.promises.readlink')),
  // An error reaches the callback rather than being thrown.
  viaCallback(fs.readlink, notALink).then(
    () => assert.fail('fs.readlink on a non-link must fail'),
    (err) => assert.strictEqual(err.code, 'EINVAL', 'fs.readlink EINVAL'),
  ),
];

// A call that never settles leaves log(42) unrun, which main.js reports.
Promise.all(pending).then(
  () => log(42),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
