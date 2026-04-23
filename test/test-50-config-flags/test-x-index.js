'use strict';

// Signal whether bakeOptions delivered --expose-gc: global gc is only defined
// when the packaged binary was started with --expose-gc baked in.
console.log(typeof global.gc === 'function' ? 'gc-on' : 'gc-off');
