'use strict';

const getAsyncFunction = require('esm-module');
const AsyncFunction = getAsyncFunction();
console.log(typeof AsyncFunction === 'function' ? 'ok' : 'fail');
