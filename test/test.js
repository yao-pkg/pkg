#!/usr/bin/env node

'use strict';

const path = require('path');
const pc = require('picocolors');
const cliProgress = require('cli-progress');
const logUpdate = require('log-update');
const { globSync } = require('tinyglobby');
const utils = require('./utils.js');
const { spawn } = require('child_process');
const host = 'node' + utils.getNodeMajorVersion();
let target = process.argv[2] || 'host';
if (target === 'host') target = host;

// note to developer , you can use
//    FLAVOR=test-1191 npm test
// if you only want to run all combination of this specific test case
// ( the env variable FLAVOR takes precedence over the second argument passed to this main.js file)

const flavor = process.env.FLAVOR || process.argv[3] || 'all';

const isCI = process.env.CI === 'true';

console.log('');
console.log('*************************************');
console.log(target + ' ' + flavor);
console.log(
  `Host Info: ${process.version} ${process.platform} ${process.arch}`,
);
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

function msToHumanDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const human = [];
  if (hours > 0) human.push(`${hours}h`);
  if (minutes > 0) human.push(`${minutes % 60}m`);
  if (seconds > 0) human.push(`${seconds % 60}s`);
  return human.join(' ');
}

function runTest(file) {
  return new Promise((resolve, reject) => {
    const process = spawn('node', [path.basename(file), target], {
      cwd: path.dirname(file),
      stdio: 'pipe',
    });
    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}`));
      } else {
        resolve();
      }
    });

    const output = [];

    process.stdout.on('data', (data) => {
      output.push(data.toString());
    });

    process.on('error', (error) => {
      error.logOutput = `${error.message}\n${output.join('')}`;
      reject(error);
    });
  });
}

async function run() {
  const progressBar = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic,
  );
  progressBar.start(files.length, 0);

  const logs = [];
  let done = 0;
  let ok = 0;
  let failed = [];
  const start = Date.now();

  function addLog(log, isError = false) {
    if (!isCI) {
      logs.push(log);
      logUpdate(logs.join('\n'));
    } else if (isError) {
      console.error(log);
    } else {
      console.log(log);
    }
  }

  const promises = files.sort().map(async (file) => {
    file = path.resolve(file);
    try {
      await runTest(file);
      ok++;
      addLog(pc.green(`✔ ${file} ok`));
    } catch (error) {
      failed.push({
        file,
        error: error.message,
        output: error.logOutput,
      });
      addLog(pc.red(`✖ ${file} FAILED (in ${target})`), true);
      addLog(pc.red(error.message), true);
    }

    done++;
    progressBar.increment();
  });

  for (let i = 0; i < promises.length; i++) {
    await promises[i];
  }

  progressBar.stop();
  logUpdate.done();

  const end = Date.now();

  console.log('');
  console.log('*************************************');
  console.log('Summary');
  console.log('*************************************');
  console.log('');

  console.log(`Total: ${done}`);
  console.log(`Ok: ${ok}`);
  console.log(`Failed: ${failed.length}`);
  // print failed tests
  for (const { file, error, output } of failed) {
    console.log('');
    console.log(pc.red(file));
    console.log(pc.red(error));
    console.log(pc.red(output));
  }
  console.log(`Time: ${msToHumanDuration(end - start)}`);
}

run();
