'use strict';

const { getMessage } = require('./lib/helper.js');

const result = getMessage();
console.log('main: ' + result);

// Verify process.pkg compatibility
console.log('pkg-exists:' + (process.pkg != null));
console.log('pkg-entrypoint:' + (typeof process.pkg.entrypoint === 'string'));
console.log(
  'pkg-path-resolve:' + (typeof process.pkg.path.resolve === 'function'),
);

// process.pkg.mount should throw in SEA mode
try {
  process.pkg.mount();
  console.log('pkg-mount:no-error');
} catch (_) {
  console.log('pkg-mount:throws');
}
