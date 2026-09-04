'use strict';

const log = require('./lib/log');

// `lib` is a symlink to `reallib`, and `reallib/inner.js` is a symlink to
// `log.js` inside it. The walker records both, so this path has its own
// manifest entry that must win over its symlinked parent.
require('./lib/inner.js');

log(42);
