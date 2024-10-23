#!/usr/bin/env node

'use strict';

const path = require('path');
const pc = require('picocolors');
const { globSync } = require('tinyglobby');
const utils = require('./utils.js');
const host = 'node' + utils.getNodeMajorVersion();
let target = process.argv[2] || 'host';
if (target === 'host') target = host;

// note to developer , you can use
//    FLAVOR=test-1191 npm test
// if you only want to run all combination of this specific test case
// ( the env variable FLAVOR takes precedence over the second argument passed to this main.js file)

const flavor = process.env.FLAVOR || process.argv[3] || 'all';

console.log('');
console.log('*************************************');
console.log(target + ' ' + flavor);
console.log('*************************************');
console.log('');

if (process.env.CI) {
  if (
    target === 'node0' ||
    target === 'node4' ||
    target === 'node6' ||
    target === 'node7' ||
    target === 'node9' ||
    target === 'node11' ||
    target === 'node13' ||
    target === 'node15'
  ) {
    console.log(target + ' is skipped in CI!');
    console.log('');
    process.exit();
  }
}

function joinAndForward(d) {
  let r = path.join(__dirname, d);
  if (process.platform === 'win32') r = r.replace(/\\/g, '/');
  return r;
}

const list = [];
const ignore = [];

// test that should be run on `host` target only
const npmTests = [
  'test-42-fetch-all',
  'test-46-multi-arch',
  'test-46-multi-arch-2',
  // 'test-79-npm', // TODO: fix this test
  'test-10-pnpm',
  'test-11-pnpm',
  'test-80-compression-node-opcua',
  'test-99-#1135',
  'test-99-#1191',
  'test-99-#1192',
  'test-00-sea',
];

if (flavor.match(/^test/)) {
  list.push(joinAndForward(`${flavor}/main.js`));
} else if (flavor === 'only-npm') {
  npmTests.forEach((t) => {
    list.push(joinAndForward(`${t}/main.js`));
  });
} else {
  list.push(joinAndForward('**/main.js'));
  if (flavor === 'no-npm') {
    // TODO: fix this test
    ignore.push(joinAndForward('test-79-npm'));
    npmTests.forEach((t) => {
      ignore.push(joinAndForward(t));
    });
  }
}

const files = globSync(list, { ignore });

files.sort().some(function (file) {
  file = path.resolve(file);
  try {
    utils.spawn.sync('node', [path.basename(file), target], {
      cwd: path.dirname(file),
      stdio: 'inherit',
    });
  } catch (error) {
    console.log();
    console.log(`> ${pc.red('Error!')} ${error.message}`);
    console.log(`> ${pc.red('Error!')} ${file} FAILED (in ${target})`);
    process.exit(2);
  }
  console.log(file, 'ok');
});
