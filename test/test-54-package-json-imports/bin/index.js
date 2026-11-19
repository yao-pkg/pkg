'use strict';

function errorCode(load) {
  try {
    return load();
  } catch (error) {
    return error.code;
  }
}

console.log(require('esm-imports').default);
console.log(require('cjs-imports'));
// declared in the package.json above this directory
console.log(require('#app/name'));
console.log(
  errorCode(() => require('#undefined')),
  errorCode(() => require('#browser-only')),
  errorCode(() => require('#missing-file')),
  errorCode(() => require('#invalid-target')),
  errorCode(() => require('#app/')),
);
