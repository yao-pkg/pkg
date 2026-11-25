import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createRequire } from 'node:module';
import { before, describe, it } from 'node:test';

const shared = createRequire(__filename)('../../prelude/bootstrap-shared.js');

// patchChildProcess rewrites the arguments of every child_process call to
// inject PKG_EXECPATH. Each call form below runs once on stock Node and once
// patched; the outcome must be the same (yao-pkg/pkg#334).

type Outcome =
  | { threw: string }
  | { error: string | null; stdout: string }
  | { timedOut: true };

const NODE = process.execPath;
const SCRIPT = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
const ARGS = ['-e', SCRIPT, 'a', 'b'];
const CMD = `${JSON.stringify(NODE)} -p 40+2`;
const PRINT_FOO = ['-p', 'process.env.FOO'];
const ASYNC_TIMEOUT_MS = 10000;

function describeError(err: unknown): string {
  const { code, message } = err as NodeJS.ErrnoException;
  return `${code}: ${message}`;
}

function runSync(call: () => unknown): Outcome {
  try {
    const ret = call() as Buffer | { stdout: Buffer; error?: Error };
    if (Buffer.isBuffer(ret)) return { error: null, stdout: String(ret) };
    return {
      error: ret.error ? describeError(ret.error) : null,
      stdout: String(ret.stdout),
    };
  } catch (err) {
    return { threw: describeError(err) };
  }
}

type Callback = (_err: Error | null, _stdout?: unknown) => void;

// Starts an async call and settles on `finish`. A call whose callback never
// fires is the bug from the issue, so it times out instead of hanging.
function runAsync(
  call: (_cb: Callback) => unknown,
  finish: (
    _child: childProcess.ChildProcess,
    _done: (_o: Outcome) => void,
  ) => void,
  cb: (_done: (_o: Outcome) => void) => Callback,
): Promise<Outcome> {
  return new Promise((resolve) => {
    let child: childProcess.ChildProcess | undefined;
    const timer = setTimeout(() => {
      child?.kill();
      resolve({ timedOut: true });
    }, ASYNC_TIMEOUT_MS);
    const done = (outcome: Outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    try {
      child = call(cb(done)) as childProcess.ChildProcess;
    } catch (err) {
      done({ threw: describeError(err) });
      return;
    }
    // node with no script reads it from stdin: give it an empty one
    child.stdin?.end();
    finish(child, done);
  });
}

// exec / execFile: the outcome is what the callback receives.
function runWithCallback(call: (_cb: Callback) => unknown): Promise<Outcome> {
  return runAsync(
    call,
    () => {},
    (done) => (err, stdout) =>
      done({ error: err ? describeError(err) : null, stdout: String(stdout) }),
  );
}

// spawn: no callback, so collect stdout until 'close'.
function runSpawn(call: () => unknown): Promise<Outcome> {
  return runAsync(
    call,
    (child, done) => {
      let stdout = '';
      child.stdout?.on('data', (d) => (stdout += d));
      child.on('close', () => done({ error: null, stdout }));
    },
    () => () => {},
  );
}

const cp = childProcess as unknown as Record<
  string,
  (..._args: unknown[]) => unknown
>;

const CASES: Record<string, () => Outcome | Promise<Outcome>> = {
  'exec(cmd, undefined, cb)': () =>
    runWithCallback((cb) => cp.exec(CMD, undefined, cb)),
  'exec(cmd, null, cb)': () => runWithCallback((cb) => cp.exec(CMD, null, cb)),
  'exec(cmd, cb)': () => runWithCallback((cb) => cp.exec(CMD, cb)),
  'exec(cmd, {}, cb)': () => runWithCallback((cb) => cp.exec(CMD, {}, cb)),
  'exec(cmd, "str", cb)': () =>
    runWithCallback((cb) => cp.exec(CMD, 'str', cb)),
  'exec(cmd, 5, cb)': () => runWithCallback((cb) => cp.exec(CMD, 5, cb)),
  'execSync(cmd)': () => runSync(() => cp.execSync(CMD)),
  'execSync(cmd, undefined)': () => runSync(() => cp.execSync(CMD, undefined)),
  'execSync(cmd, null)': () => runSync(() => cp.execSync(CMD, null)),
  'execSync(cmd, [])': () => runSync(() => cp.execSync(CMD, [])),
  'execSync(123)': () => runSync(() => cp.execSync(123)),
  'execFile(file, undefined, cb)': () =>
    runWithCallback((cb) => cp.execFile(NODE, undefined, cb)),
  'execFile(file, null, cb)': () =>
    runWithCallback((cb) => cp.execFile(NODE, null, cb)),
  'execFile(file, cb)': () => runWithCallback((cb) => cp.execFile(NODE, cb)),
  'execFile(file, {}, cb)': () =>
    runWithCallback((cb) => cp.execFile(NODE, {}, cb)),
  'execFile(file, "bad", cb)': () =>
    runWithCallback((cb) => cp.execFile(NODE, 'bad', cb)),
  'execFile(file, args, cb)': () =>
    runWithCallback((cb) => cp.execFile(NODE, ARGS, cb)),
  'execFile(file, args, undefined, cb)': () =>
    runWithCallback((cb) => cp.execFile(NODE, ARGS, undefined, cb)),
  'execFile(file, args, null, cb)': () =>
    runWithCallback((cb) => cp.execFile(NODE, ARGS, null, cb)),
  'execFile(file, args, "bad", cb)': () =>
    runWithCallback((cb) => cp.execFile(NODE, ARGS, 'bad', cb)),
  'execFile(file, args, {}, "bad")': () =>
    runWithCallback(() => cp.execFile(NODE, ARGS, {}, 'bad')),
  'execFileSync(file, undefined)': () =>
    runSync(() => cp.execFileSync(NODE, undefined)),
  'execFileSync(file, args, undefined)': () =>
    runSync(() => cp.execFileSync(NODE, ARGS, undefined)),
  'execFileSync(file, args, null)': () =>
    runSync(() => cp.execFileSync(NODE, ARGS, null)),
  'execFileSync(file, {})': () => runSync(() => cp.execFileSync(NODE, {})),
  'execFileSync with inherited env keys': () =>
    runSync(() =>
      cp.execFileSync(NODE, PRINT_FOO, { env: Object.create({ FOO: 'bar' }) }),
    ),
  'execFileSync with an inherited options.env': () =>
    runSync(() =>
      cp.execFileSync(
        NODE,
        PRINT_FOO,
        Object.create({ env: { FOO: 'bar', PATH: process.env.PATH } }),
      ),
    ),
  'spawn(file, args, undefined)': () =>
    runSpawn(() => cp.spawn(NODE, ARGS, undefined)),
  'spawn(file, undefined, {})': () =>
    runSpawn(() => cp.spawn(NODE, undefined, {})),
  'spawn(file, args, null)': () => runSpawn(() => cp.spawn(NODE, ARGS, null)),
  'spawn(file, "bad")': () => runSpawn(() => cp.spawn(NODE, 'bad')),
  'spawn(123)': () => runSpawn(() => cp.spawn(123)),
  'spawnSync(file, args, undefined)': () =>
    runSync(() => cp.spawnSync(NODE, ARGS, undefined)),
  'spawnSync(file, null, null)': () =>
    runSync(() => cp.spawnSync(NODE, null, null)),
  'spawnSync(file, {})': () => runSync(() => cp.spawnSync(NODE, {})),
  'spawnSync(file, args, [])': () =>
    runSync(() => cp.spawnSync(NODE, ARGS, [])),
};

const PRINT_ENV = ['-p', 'process.env.PKG_EXECPATH'];
const PRINT_ENV_CMD = `${JSON.stringify(NODE)} ${PRINT_ENV.join(' ')}`;

// One undefined/null-options form per function, run patched only.
const INJECTION: Record<string, () => Outcome | Promise<Outcome>> = {
  exec: () => runWithCallback((cb) => cp.exec(PRINT_ENV_CMD, undefined, cb)),
  // execSync reaches Node's internal spawnSync, not the patched export
  'execSync with non-object options': () =>
    runSync(() => cp.execSync(PRINT_ENV_CMD, 'str')),
  execSync: () => runSync(() => cp.execSync(PRINT_ENV_CMD, null)),
  execFile: () =>
    runWithCallback((cb) => cp.execFile(NODE, PRINT_ENV, undefined, cb)),
  execFileSync: () => runSync(() => cp.execFileSync(NODE, PRINT_ENV, null)),
  spawn: () => runSpawn(() => cp.spawn(NODE, PRINT_ENV, undefined)),
  spawnSync: () => runSync(() => cp.spawnSync(NODE, PRINT_ENV, undefined)),
};

describe('patchChildProcess', () => {
  const stock: Record<string, Outcome> = {};

  before(async () => {
    for (const [name, run] of Object.entries(CASES)) {
      stock[name] = await run();
    }
    shared.patchChildProcess('/snapshot/app/index.js');
  });

  for (const [name, run] of Object.entries(CASES)) {
    it(`${name} behaves like stock Node`, async () => {
      assert.notDeepEqual(stock[name], { timedOut: true });
      assert.deepEqual(await run(), stock[name]);
    });
  }

  // In-process the patch's EXECPATH is process.execPath, i.e. NODE.
  for (const [name, run] of Object.entries(INJECTION)) {
    it(`${name} injects PKG_EXECPATH into the child env`, async () => {
      const outcome = (await run()) as { stdout: string };
      assert.equal(outcome.stdout.trim(), NODE);
    });
  }

  it('keeps a caller-set PKG_EXECPATH', () => {
    const out = cp.execFileSync(NODE, PRINT_ENV, {
      env: { PKG_EXECPATH: 'mine' },
    }) as Buffer;
    assert.equal(String(out).trim(), 'mine');
  });

  it('does not mutate the caller options, env or args', () => {
    const env = { FOO: 'bar' };
    const options = { env };
    const args = ['-p', 'process.env.FOO + " " + process.env.PKG_EXECPATH'];
    const argsCopy = [...args];

    const out = cp.execFileSync(NODE, args, options) as Buffer;

    assert.equal(String(out).trim(), `bar ${NODE}`);
    assert.deepEqual(options, { env: { FOO: 'bar' } });
    assert.equal(options.env, env);
    assert.deepEqual(args, argsCopy);
  });
});
