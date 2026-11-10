'use strict';

// CJS entry that requires an ESM file whose dependency uses
// package.json "imports" (like node-opcua 2.186+ with chalk 6)
console.log(require('./esm/index.js').default);
console.log(require('cjs-imports'));
