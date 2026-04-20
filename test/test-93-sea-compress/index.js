'use strict';

const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, 'payload.txt');
const data = fs.readFileSync(p, 'utf8');
const stat = fs.statSync(p);
// Print deterministic values so the packaged binary can be size-gated from
// test setup: full length + head + stat.size (must be uncompressed length).
console.log('len=' + data.length);
console.log('head=' + data.slice(0, 32));
console.log('stat=' + stat.size);
