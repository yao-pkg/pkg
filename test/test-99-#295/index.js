'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isSea } = require('node:sea');

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
  `realpath of the nested link (nestedIsLink=${nestedIsLink})`,
);
assert.strictEqual(
  path.basename(fs.realpathSync(path.join(__dirname, 'lib', 'log.js'))),
  'log.js',
  'realpath through the linked directory',
);

// ...in the platform's path form, `C:\snapshot\...` on Windows (#305). Only
// Windows can tell the two forms apart; elsewhere this passes trivially.
assert.strictEqual(
  fs.realpathSync(__filename),
  __filename,
  'realpath must round-trip a non-link in the platform path form',
);

// readdir *of the linked directory* must list what the link points at.
assert.deepStrictEqual(
  fs.readdirSync(path.join(__dirname, 'lib')).sort(),
  ['inner.js', 'log.js', 'package.json'],
  'readdir of the linked directory',
);

// A miss through the linked directory is a proper ENOENT. SEA errors come
// from vfs; standard mode builds its own.
assert.throws(
  () => fs.statSync(path.join(__dirname, 'lib', 'missing.js')),
  (error) => {
    assert.strictEqual(error.code, 'ENOENT');
    assert.strictEqual(path.basename(error.path), 'missing.js');
    if (isSea()) assert.strictEqual(error.syscall, 'stat');
    else assert.strictEqual(error.pkg, true);
    return true;
  },
);

log(42);
