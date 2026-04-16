#!/usr/bin/env node

'use strict';

const os = require('os');
const path = require('path');
const pc = require('picocolors');
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
// If a 4th argument is provided and flavor is not a test name, use the 4th argument as test filter
const testFilter = process.argv[4] || (flavor.match(/^test/) ? flavor : null);

const isCI = process.env.CI === 'true';

// Concurrency for parallel test execution. Defaults to CPU count (capped at 4).
// Set TEST_CONCURRENCY=1 to run tests sequentially.
const concurrency =
  parseInt(process.env.TEST_CONCURRENCY, 10) ||
  Math.min(os.availableParallelism?.() ?? os.cpus().length, 4);

console.log('');
console.log('*************************************');
console.log(target + ' ' + flavor);
console.log(
  `Host Info: ${process.version} ${process.platform} ${process.arch}`,
);
console.log(`Concurrency: ${concurrency}`);
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
  'test-01-hybrid-esm',
  'test-42-fetch-all',
  'test-46-multi-arch',
  'test-46-multi-arch-2',
  // 'test-79-npm', // TODO: fix this test
  'test-10-pnpm',
  'test-11-pnpm',
  'test-50-aedes-esm',
  'test-50-esm-pure',
  'test-50-uuid-v10',
  'test-80-compression-node-opcua',
  'test-99-#1135',
  'test-99-#1191',
  'test-99-#1192',
  // SEA tests — they ignore the target argument (always build for the host
  // Node version), so running them in both test:22 and test:24 is redundant.
  'test-00-sea',
  'test-85-sea-enhanced',
  'test-86-sea-assets',
  'test-87-sea-esm',
  'test-89-sea-fs-ops',
  'test-90-sea-worker-threads',
  'test-91-sea-esm-entry',
  'test-92-sea-tla',
];

if (testFilter) {
  list.push(joinAndForward(`${testFilter}/main.js`));
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
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const human = [];
  if (hours > 0) human.push(`${hours}h`);
  if (minutes > 0) human.push(`${minutes % 60}m`);
  if (seconds > 0) human.push(`${seconds % 60}s`);
  return human.join(' ');
}

/** @type {Array<import('child_process').ChildProcessWithoutNullStreams>} */
const activeProcesses = [];

function runTest(file) {
  return new Promise((resolve, reject) => {
    const process = spawn('node', [path.basename(file), target], {
      cwd: path.dirname(file),
      stdio: 'pipe',
    });

    activeProcesses.push(process);

    const removeProcess = () => {
      const index = activeProcesses.indexOf(process);
      if (index !== -1) {
        activeProcesses.splice(index, 1);
      }
    };

    const output = [];

    const rejectWithError = (error) => {
      error.logOutput = `${error.message}\n${output.join('')}`;
      reject(error);
    };

    process.on('close', (code) => {
      removeProcess();
      if (code !== 0) {
        rejectWithError(new Error(`Process exited with code ${code}`));
      } else {
        resolve();
      }
    });

    process.stdout.on('data', (data) => {
      output.push(data.toString());
    });

    process.stderr.on('data', (data) => {
      output.push(data.toString());
    });

    process.on('error', (error) => {
      removeProcess();
      rejectWithError(error);
    });
  });
}

const clearLastLine = () => {
  if (
    isCI ||
    !process.stdout.isTTY ||
    typeof process.stdout.moveCursor !== 'function' ||
    typeof process.stdout.clearLine !== 'function'
  )
    return;
  process.stdout.moveCursor(0, -1); // up one line
  process.stdout.clearLine(1); // from cursor to end
};

async function run() {
  let done = 0;
  let ok = 0;
  let failed = [];
  const start = Date.now();

  const isParallel = concurrency > 1;

  function addLog(log, isError = false) {
    // Only use TTY line-clearing in sequential mode — parallel output
    // interleaves, so clearing lines would eat other tests' results.
    if (!isParallel) clearLastLine();
    if (isError) {
      console.error(log);
    } else {
      console.log(log);
    }
  }

  const promises = files.sort().map((file) => async () => {
    file = path.resolve(file);
    const startTest = Date.now();
    try {
      if (!isParallel && !isCI && process.stdout.isTTY) {
        console.log(pc.gray(`⏳ ${file} - ${done}/${files.length}`));
      }
      await runTest(file);
      ok++;
      addLog(
        pc.green(`✔ ${file} ok - ${msToHumanDuration(Date.now() - startTest)}`),
      );
    } catch (error) {
      failed.push({
        file,
        output: error.logOutput,
      });
      addLog(
        pc.red(
          `✖ ${file} FAILED (in ${target}) - ${msToHumanDuration(Date.now() - startTest)}\n${error.message}`,
        ),
        true,
      );
    }

    done++;
  });

  // Run tests with bounded concurrency
  const executing = new Set();
  for (const task of promises) {
    const p = task().finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);

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
  for (const { file, output } of failed) {
    console.log('');
    console.log(`--- ${file} ---`);
    console.log(pc.red(output));
  }
  console.log(`Time: ${msToHumanDuration(end - start)}`);

  if (failed.length > 0) {
    process.exit(2);
  }
}

let isExiting = false;

function cleanup(signal) {
  if (isExiting) return;
  isExiting = true;

  console.log(`\n\nReceived ${signal}, cleaning up...`);

  for (const process of activeProcesses) {
    try {
      process.kill('SIGTERM');
    } catch (_error) {
      // Ignore errors when killing processes
    }
  }

  // Exit immediately
  process.exit(130); // 128 + SIGINT(2) = 130
}

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));

run();
