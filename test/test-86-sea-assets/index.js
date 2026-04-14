'use strict';

const fs = require('fs');
const path = require('path');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'),
);
console.log('config:' + config.key);

const data = fs.readFileSync(path.join(__dirname, 'data.txt'), 'utf8').trim();
console.log('data:' + data);
