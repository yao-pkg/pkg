import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import vm from 'node:vm';

const sharedPath = path.join(__dirname, '../../prelude/bootstrap-shared.js');
const sharedSource = fs.readFileSync(sharedPath, 'utf8');
const requireBuiltin = createRequire(__filename);
// Synthetic bytes only: the fake dlopen below never loads a native library.
const fresh = Buffer.from([0, 1, 2, 3, 4, 5, 255, 0]);
// A cache file truncated by the old in-place write.
const stale = fresh.subarray(0, 3);
const raced = Buffer.from([0, 1, 2, 3, 4, 6, 255, 0]);
type Layout = 'node_modules' | 'standalone';
// diskFull: the temp write stops after 3 bytes with ENOSPC.
// renameRefused: Windows-style EPERM on rename, optionally after a concurrent
// writer published `winner` at the destination.
// renameBusyOnce: the first rename fails with EBUSY, as when antivirus holds
// the just-written temp file.
// tempDenied: the cache dir is read-only, so creating the temp file fails.
// tempTaken: another writer already owns the temp file name.
// linkRaced: another process recreates a symlink just before we do.
type Failure =
  | 'diskFull'
  | 'renameRefused'
  | 'renameBusyOnce'
  | 'tempDenied'
  | 'tempTaken'
  | 'linkRaced';

// The fs the prelude sees inside the VM: records writes and renames, injects
// one failure.
function faultyFs(failure: Failure | undefined, error: Error, winner?: Buffer) {
  const writes: { file: string; flag?: string }[] = [];
  const renames: { from: string; to: string }[] = [];
  const vmFs = {
    ...fs,
    writeFileSync(file: string, bytes: Buffer, options?: { flag?: string }) {
      writes.push({ file, flag: options?.flag });
      if (options?.flag === 'wx' && failure === 'tempDenied') throw error;
      if (options?.flag === 'wx' && failure === 'tempTaken') {
        fs.writeFileSync(file, raced);
        throw error;
      }
      if (failure === 'diskFull') {
        fs.writeFileSync(file, bytes.subarray(0, 3), options);
        throw error;
      }
      fs.writeFileSync(file, bytes, options);
    },
    renameSync(from: string, to: string) {
      renames.push({ from, to });
      if (failure === 'renameRefused') {
        if (winner) fs.writeFileSync(to, winner);
        throw error;
      }
      if (failure === 'renameBusyOnce' && renames.length === 1) throw error;
      fs.renameSync(from, to);
    },
    symlinkSync(target: string, file: string) {
      if (failure === 'linkRaced') fs.symlinkSync(target, file);
      fs.symlinkSync(target, file);
    },
  };
  return { writes, renames, vmFs };
}

function fixture(
  t: TestContext,
  layout: Layout,
  options: { failure?: Failure; winner?: Buffer; platform?: string } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-native-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const snapshot = path.join(root, 'snapshot');
  const hash = createHash('sha256').update(fresh).digest('hex');
  const cacheRoot = path.join(root, 'cache');
  const cache = path.join(cacheRoot, 'pkg', hash);
  const relative =
    layout === 'node_modules'
      ? path.join('sample-addon', 'build', 'Release', 'addon.node')
      : 'addon.node';
  const sourceRoot =
    layout === 'node_modules' ? path.join(snapshot, 'node_modules') : snapshot;
  const destination = path.join(cache, relative);
  fs.mkdirSync(path.dirname(path.join(sourceRoot, relative)), {
    recursive: true,
  });
  fs.writeFileSync(path.join(sourceRoot, relative), fresh);

  const [code, syscall] = {
    diskFull: ['ENOSPC', 'write'],
    renameRefused: ['EPERM', 'rename'],
    renameBusyOnce: ['EBUSY', 'rename'],
    tempDenied: ['EACCES', 'open'],
    tempTaken: ['EEXIST', 'open'],
    linkRaced: ['EEXIST', 'symlink'],
  }[options.failure ?? 'renameRefused'];
  const error = Object.assign(new Error('injected cache failure'), {
    code,
    syscall,
  });
  const { writes, renames, vmFs } = faultyFs(
    options.failure,
    error,
    options.winner,
  );
  const loads: { file: string; bytes: Buffer }[] = [];
  const fakeProcess = {
    env: { PKG_NATIVE_CACHE_PATH: cacheRoot },
    pid: process.pid,
    platform: options.platform ?? 'linux',
    versions: process.versions,
    dlopen(_module: object, file: string) {
      loads.push({ file, bytes: fs.readFileSync(file) });
      return 'loaded';
    },
  };
  const shared = {
    exports: {} as {
      patchDlopen: (_inside: (_file: string) => boolean) => void;
    },
  };
  // Evaluate the actual shared prelude, without importing a generated SEA bundle
  // or patching the test runner's process.dlopen / filesystem module.
  vm.runInNewContext(
    sharedSource,
    {
      Buffer,
      process: fakeProcess,
      module: shared,
      require: (id: string) => (id === 'fs' ? vmFs : requireBuiltin(id)),
    },
    { filename: sharedPath },
  );
  shared.exports.patchDlopen((file) => file.startsWith(snapshot + path.sep));

  // Both helpers take paths relative to the addon's own directory.
  const write = (base: string, file: string, bytes: Buffer) => {
    const target = path.join(path.dirname(path.join(base, relative)), file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    return target;
  };

  return {
    destination,
    writes,
    renames,
    loads,
    error,
    load: () => fakeProcess.dlopen({}, path.join(sourceRoot, relative)),
    addSource: (file: string, bytes: Buffer) => write(sourceRoot, file, bytes),
    seed: (bytes: Buffer, file = path.basename(destination)) =>
      write(cache, file, bytes),
    tempFiles: () =>
      (fs.readdirSync(cache, { recursive: true }) as string[]).filter((f) =>
        f.endsWith('.tmp'),
      ),
  };
}

function assertPublishedViaSibling(f: ReturnType<typeof fixture>) {
  assert.equal(f.renames.length, 1);
  const [{ from, to }] = f.renames;
  assert.equal(to, f.destination);
  assert.notEqual(from, f.destination);
  assert.equal(path.dirname(from), path.dirname(f.destination));
}

for (const layout of ['node_modules', 'standalone'] as const) {
  describe(`native addon cache (${layout})`, () => {
    it('publishes a cold cache via a sibling temp file', (t) => {
      const f = fixture(t, layout);

      assert.equal(f.load(), 'loaded');
      assert.deepEqual(f.loads, [{ file: f.destination, bytes: fresh }]);
      assertPublishedViaSibling(f);
      assert.deepEqual(f.writes, [{ file: f.renames[0].from, flag: 'wx' }]);
      assert.deepEqual(f.tempFiles(), []);
    });

    it('replaces a stale cache via a sibling temp file', (t) => {
      const f = fixture(t, layout);
      f.seed(stale);

      assert.equal(f.load(), 'loaded');
      assert.deepEqual(f.loads, [{ file: f.destination, bytes: fresh }]);
      assertPublishedViaSibling(f);
      assert.deepEqual(f.tempFiles(), []);
    });

    it('does not rewrite an identical warm cache', (t) => {
      const f = fixture(t, layout);
      f.seed(fresh);

      assert.equal(f.load(), 'loaded');
      assert.deepEqual(f.loads, [{ file: f.destination, bytes: fresh }]);
      assert.deepEqual(f.renames, []);
    });
  });
}

describe('native addon cache failures', () => {
  it('removes a partial temp file after ENOSPC', (t) => {
    const f = fixture(t, 'standalone', { failure: 'diskFull' });
    f.seed(stale);

    assert.throws(f.load, (err: Error & { code: string }) => {
      assert.equal(err.cause, f.error);
      assert.equal(err.code, 'ENOSPC');
      assert.ok(err.message.includes(f.destination), 'names the addon');
      return true;
    });
    assert.deepEqual(f.loads, []);
    assert.deepEqual(f.renames, [], 'must not publish partial bytes');
    assert.deepEqual(fs.readFileSync(f.destination), stale);
    assert.deepEqual(f.tempFiles(), []);
  });

  it('removes the temp file after a refused rename', (t) => {
    const f = fixture(t, 'standalone', { failure: 'renameRefused' });
    f.seed(stale);

    assert.throws(f.load, (err) => err === f.error);
    assert.deepEqual(f.loads, []);
    assert.deepEqual(fs.readFileSync(f.destination), stale);
    assert.deepEqual(f.tempFiles(), []);
  });

  it('accepts a rename race won with the same bytes', (t) => {
    const f = fixture(t, 'standalone', {
      failure: 'renameRefused',
      winner: fresh,
    });

    assert.equal(f.load(), 'loaded');
    assert.deepEqual(f.loads, [{ file: f.destination, bytes: fresh }]);
    assert.deepEqual(f.tempFiles(), []);
  });

  it('rejects a rename race won with different bytes', (t) => {
    const f = fixture(t, 'standalone', {
      failure: 'renameRefused',
      winner: raced,
    });

    assert.throws(f.load, (err) => err === f.error);
    assert.deepEqual(f.loads, []);
    assert.deepEqual(fs.readFileSync(f.destination), raced);
    assert.deepEqual(f.tempFiles(), []);
  });

  it('retries a rename refused by a briefly held file on Windows', (t) => {
    const f = fixture(t, 'standalone', {
      failure: 'renameBusyOnce',
      platform: 'win32',
    });

    assert.equal(f.load(), 'loaded');
    assert.deepEqual(f.loads, [{ file: f.destination, bytes: fresh }]);
    assert.equal(f.renames.length, 2);
    assert.deepEqual(f.tempFiles(), []);
  });

  it('does not retry a refused rename outside Windows', (t) => {
    const f = fixture(t, 'standalone', { failure: 'renameBusyOnce' });

    assert.throws(f.load, (err) => err === f.error);
    assert.equal(f.renames.length, 1);
    assert.deepEqual(f.tempFiles(), []);
  });

  it('gives up on Windows after 5 refused renames', (t) => {
    const f = fixture(t, 'standalone', {
      failure: 'renameRefused',
      platform: 'win32',
    });

    assert.throws(f.load, (err) => err === f.error);
    assert.equal(f.renames.length, 5);
    assert.deepEqual(f.tempFiles(), []);
  });

  it('stops retrying on Windows once a winner has the same bytes', (t) => {
    const f = fixture(t, 'standalone', {
      failure: 'renameRefused',
      platform: 'win32',
      winner: fresh,
    });

    assert.equal(f.load(), 'loaded');
    assert.equal(f.renames.length, 1);
    assert.deepEqual(f.tempFiles(), []);
  });

  it('updates in place when the cache dir is read-only', (t) => {
    const f = fixture(t, 'standalone', { failure: 'tempDenied' });
    f.seed(stale);

    assert.equal(f.load(), 'loaded');
    assert.deepEqual(f.loads, [{ file: f.destination, bytes: fresh }]);
    assert.deepEqual(f.renames, []);
  });

  it("does not remove another writer's temp file", (t) => {
    const f = fixture(t, 'standalone', { failure: 'tempTaken' });
    f.seed(stale);

    assert.throws(f.load, (err: Error) => err.cause === f.error);
    assert.equal(f.tempFiles().length, 1);
    assert.deepEqual(fs.readFileSync(f.destination), stale);
  });

  it('keeps the rename error when the destination cannot be read', (t) => {
    const f = fixture(t, 'standalone', { failure: 'renameRefused' });
    fs.mkdirSync(f.destination, { recursive: true });

    assert.throws(f.load, (err) => err === f.error);
    assert.deepEqual(f.loads, []);
    assert.ok(fs.statSync(f.destination).isDirectory());
    assert.deepEqual(f.tempFiles(), []);
  });
});

describe('native addon cache (copied package)', () => {
  it('rewrites only the stale files of a copied package', (t) => {
    const f = fixture(t, 'node_modules');
    f.addSource('../../package.json', fresh);
    f.addSource('deps/libhelper.so', fresh);
    f.seed(fresh);
    f.seed(fresh, '../../package.json');
    const staleHelper = f.seed(stale, 'deps/libhelper.so');

    assert.equal(f.load(), 'loaded');
    assert.deepEqual(
      f.renames.map(({ to }) => to),
      [staleHelper],
    );
    assert.deepEqual(fs.readFileSync(staleHelper), fresh);
    assert.deepEqual(f.tempFiles(), []);
  });

  it('accepts a symlink another process recreated first', (t) => {
    const f = fixture(t, 'node_modules', { failure: 'linkRaced' });
    const helper = f.addSource('libhelper.so', fresh);
    fs.symlinkSync(
      'libhelper.so',
      path.join(path.dirname(helper), 'libhelper.so.1'),
    );

    assert.equal(f.load(), 'loaded');
    const link = path.join(path.dirname(f.destination), 'libhelper.so.1');
    assert.equal(fs.readlinkSync(link), 'libhelper.so');
  });
});
