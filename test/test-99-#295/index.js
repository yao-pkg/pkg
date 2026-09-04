'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const log = require('./lib/log');

// `lib` is a symlink to `reallib`, and `reallib/inner.js` is a symlink to
// `log.js` inside it. The walker records both, so this path has its own
// manifest entry that must win over its symlinked parent.
require('./lib/inner.js');

const nested = path.join(__dirname, 'lib', 'inner.js');

// realpath must follow the chain rather than throwing ENOENT.
assert.strictEqual(path.basename(fs.realpathSync(nested)), 'log.js');
assert.strictEqual(
  path.basename(fs.realpathSync(path.join(__dirname, 'lib', 'log.js'))),
  'log.js',
);

// The VFS answers readlink by way of realpath, so this only holds in SEA
// mode — the classic bootstrap does not patch fs.readlinkSync at all.
let isSea = false;
try {
  isSea = require('node:sea').isSea();
} catch {
  isSea = false;
}
if (isSea) {
  assert.strictEqual(path.basename(fs.readlinkSync(nested)), 'log.js');
}

log(42);
