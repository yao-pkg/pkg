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

// readdir *of the linked directory* must list what the link points at.
assert.ok(
  fs.readdirSync(path.join(__dirname, 'lib')).includes('log.js'),
  'log.js missing from readdir of the linked directory',
);

log(42);
