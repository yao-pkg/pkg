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

function errorCode(err: unknown): string {
  return (err as NodeJS.ErrnoException).code ?? String(err);
}

function runSync(call: () => unknown): Outcome {
  try {
    const ret = call() as Buffer | { stdout: Buffer; error?: Error };
    if (Buffer.isBuffer(ret)) return { error: null, stdout: String(ret) };
    return {
      error: ret.error ? errorCode(ret.error) : null,
      stdout: String(ret.stdout),
    };
  } catch (err) {
    return { threw: errorCode(err) };
  }
}

type Callback = (_err: Error | null, _stdout?: unknown) => void;

// Async forms take a callback, or (spawn) report through 'close'. A call
// whose callback never fires is the bug from the issue, so time it out.
function runAsync(
  call: (_cb: Callback) => childProcess.ChildProcess,
  viaClose = false,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), 10000);
    const done = (outcome: Outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    let child: childProcess.ChildProcess;
    try {
      child = call((err, stdout) =>
        done({ error: err ? errorCode(err) : null, stdout: String(stdout) }),
      );
    } catch (err) {
      done({ threw: errorCode(err) });
      return;
    }
    // node with no script reads it from stdin: give it an empty one
    child.stdin?.end();
    if (viaClose) {
      let stdout = '';
      child.stdout?.on('data', (d) => (stdout += d));
      child.on('close', () => done({ error: null, stdout }));
    }
  });
}

const cp = childProcess as unknown as Record<
  string,
  (..._args: unknown[]) => unknown
>;

const CASES: Record<string, () => Outcome | Promise<Outcome>> = {
  'exec(cmd, undefined, cb)': () =>
    runAsync((cb) => cp.exec(CMD, undefined, cb) as childProcess.ChildProcess),
  'exec(cmd, null, cb)': () =>
    runAsync((cb) => cp.exec(CMD, null, cb) as childProcess.ChildProcess),
  'exec(cmd, cb)': () =>
    runAsync((cb) => cp.exec(CMD, cb) as childProcess.ChildProcess),
  'exec(cmd, {}, cb)': () =>
    runAsync((cb) => cp.exec(CMD, {}, cb) as childProcess.ChildProcess),
  'execSync(cmd)': () => runSync(() => cp.execSync(CMD)),
  'execSync(cmd, undefined)': () => runSync(() => cp.execSync(CMD, undefined)),
  'execSync(cmd, null)': () => runSync(() => cp.execSync(CMD, null)),
  'execFile(file, undefined, cb)': () =>
    runAsync(
      (cb) => cp.execFile(NODE, undefined, cb) as childProcess.ChildProcess,
    ),
  'execFile(file, null, cb)': () =>
    runAsync((cb) => cp.execFile(NODE, null, cb) as childProcess.ChildProcess),
  'execFile(file, cb)': () =>
    runAsync((cb) => cp.execFile(NODE, cb) as childProcess.ChildProcess),
  'execFile(file, {}, cb)': () =>
    runAsync((cb) => cp.execFile(NODE, {}, cb) as childProcess.ChildProcess),
  'execFile(file, args, cb)': () =>
    runAsync((cb) => cp.execFile(NODE, ARGS, cb) as childProcess.ChildProcess),
  'execFile(file, args, undefined, cb)': () =>
    runAsync(
      (cb) =>
        cp.execFile(NODE, ARGS, undefined, cb) as childProcess.ChildProcess,
    ),
  'execFile(file, args, null, cb)': () =>
    runAsync(
      (cb) => cp.execFile(NODE, ARGS, null, cb) as childProcess.ChildProcess,
    ),
  'execFile(file, args, "bad", cb)': () =>
    runAsync(
      (cb) => cp.execFile(NODE, ARGS, 'bad', cb) as childProcess.ChildProcess,
    ),
  'execFile(file, args, {}, "bad")': () =>
    runAsync(
      () => cp.execFile(NODE, ARGS, {}, 'bad') as childProcess.ChildProcess,
    ),
  'execFileSync(file, undefined)': () =>
    runSync(() => cp.execFileSync(NODE, undefined)),
  'execFileSync(file, args, undefined)': () =>
    runSync(() => cp.execFileSync(NODE, ARGS, undefined)),
  'execFileSync(file, args, null)': () =>
    runSync(() => cp.execFileSync(NODE, ARGS, null)),
  'execFileSync(file, {})': () => runSync(() => cp.execFileSync(NODE, {})),
  'spawn(file, args, undefined)': () =>
    runAsync(
      () => cp.spawn(NODE, ARGS, undefined) as childProcess.ChildProcess,
      true,
    ),
  'spawn(file, undefined, {})': () =>
    runAsync(
      () => cp.spawn(NODE, undefined, {}) as childProcess.ChildProcess,
      true,
    ),
  'spawn(file, args, null)': () =>
    runAsync(() => cp.spawn(NODE, ARGS, null) as childProcess.ChildProcess),
  'spawn(file, "bad")': () =>
    runAsync(() => cp.spawn(NODE, 'bad') as childProcess.ChildProcess),
  'spawnSync(file, args, undefined)': () =>
    runSync(() => cp.spawnSync(NODE, ARGS, undefined)),
  'spawnSync(file, null, null)': () =>
    runSync(() => cp.spawnSync(NODE, null, null)),
  'spawnSync(file, {})': () => runSync(() => cp.spawnSync(NODE, {})),
  'spawnSync(file, args, [])': () =>
    runSync(() => cp.spawnSync(NODE, ARGS, [])),
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

  it('injects PKG_EXECPATH into the child env', () => {
    const out = cp.execFileSync(NODE, [
      '-p',
      'process.env.PKG_EXECPATH',
    ]) as Buffer;
    assert.equal(String(out).trim(), NODE);
  });

  it('keeps a caller-set PKG_EXECPATH', () => {
    const out = cp.execFileSync(NODE, ['-p', 'process.env.PKG_EXECPATH'], {
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
