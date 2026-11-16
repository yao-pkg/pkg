'use strict';

// CJS entry that requires an ESM package using package.json "imports"
// (like node-opcua 2.186+ with chalk 6), a CJS package using them, and
// an import of the app's own package.json
console.log(require('esm-imports').default);
console.log(require('cjs-imports'));
console.log(require('#app/name'));
