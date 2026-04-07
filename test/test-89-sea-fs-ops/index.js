'use strict';

const fs = require('fs');
const path = require('path');

// Test existsSync
console.log('exists-index:' + fs.existsSync(path.join(__dirname, 'index.js')));
console.log('exists-missing:' + fs.existsSync(path.join(__dirname, 'nope.js')));

// Test statSync
const stat = fs.statSync(path.join(__dirname, 'index.js'));
console.log('stat-isFile:' + stat.isFile());
console.log('stat-isDir:' + stat.isDirectory());

const dirStat = fs.statSync(__dirname);
console.log('dir-isFile:' + dirStat.isFile());
console.log('dir-isDir:' + dirStat.isDirectory());

// Test readdirSync
const entries = fs.readdirSync(__dirname).sort();
console.log('readdir:' + entries.join(','));

// Test readFileSync
const content = fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8');
const parsed = JSON.parse(content);
console.log('readFile:' + parsed.test);
