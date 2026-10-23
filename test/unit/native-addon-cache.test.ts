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
const content = Buffer.from([0, 1, 2, 3, 4, 5, 255, 0]);
const previous = Buffer.from([8, 7, 6, 5, 4, 3, 2, 1]);
const different = Buffer.from([0, 1, 2, 3, 4, 6, 255, 0]);
type Layout = 'node_modules' | 'standalone';

function fixture(
  t: TestContext,
  layout: Layout,
  options: {
    fail?: 'write' | 'rename' | 'open';
    winner?: Buffer;
    filename?: string;
  } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-native-cache-'));
  const liveDescriptors = new Set<number>();
  t.after(() => {
    // Also release leaked descriptors when testing a broken implementation.
    for (const fd of liveDescriptors) fs.closeSync(fd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const snapshot = path.join(root, 'snapshot');
  const cache = path.join(root, 'cache');
  const filename = options.filename ?? 'addon.node';
  const relative =
    layout === 'node_modules'
      ? path.join('sample-addon', 'build', 'Release', filename)
      : filename;
  const source = path.join(
    snapshot,
    layout === 'node_modules' ? 'node_modules' : '',
    relative,
  );
  const hash = createHash('sha256').update(content).digest('hex');
  const destination = path.join(cache, 'pkg', hash, relative);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, content);

  const opens: { file: string; flags: string; fd?: number }[] = [];
  const writes: (string | number)[] = [];
  const closes: number[] = [];
  const renames: { from: string; to: string; before?: Buffer }[] = [];
  const loads: { file: string; bytes: Buffer }[] = [];
  const error = Object.assign(new Error('injected cache failure'), {
    code: options.fail === 'write' ? 'ENOSPC' : 'EPERM',
  });
  let collision: string | undefined;

  // Only the VM sees these wrappers; fixture setup and inspection use real fs.
  const wrappedFs = {
    ...fs,
    openSync(file: string, flags: string) {
      const attempt: (typeof opens)[number] = { file, flags };
      opens.push(attempt);
      if (options.fail === 'open') {
        // Another writer owns this exact candidate before our exclusive open.
        collision = file;
        fs.writeFileSync(file, different);
      }
      const fd = fs.openSync(file, flags);
      attempt.fd = fd;
      liveDescriptors.add(fd);
      return fd;
    },
    writeFileSync(file: string | number, bytes: Buffer) {
      writes.push(file);
      if (options.fail === 'write') {
        fs.writeFileSync(file, bytes.subarray(0, 3));
        throw error;
      }
      fs.writeFileSync(file, bytes);
    },
    closeSync(fd: number) {
      fs.closeSync(fd);
      liveDescriptors.delete(fd);
      closes.push(fd);
    },
    renameSync(from: string, to: string) {
      renames.push({
        from,
        to,
        before: fs.existsSync(to) ? fs.readFileSync(to) : undefined,
      });
      assert.deepEqual(fs.readFileSync(from), content);
      assert.equal(liveDescriptors.size, 0, 'close before publishing');
      if (options.fail === 'rename') {
        // Deterministic Windows-style race: a winner appears, then rename fails.
        // No timing, child processes, or host-specific rename semantics needed.
        if (options.winner) fs.writeFileSync(to, options.winner);
        throw error;
      }
      fs.renameSync(from, to);
    },
  };
  const fakeProcess = {
    env: { PKG_NATIVE_CACHE_PATH: cache },
    pid: process.pid,
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
      require: (id: string) => (id === 'fs' ? wrappedFs : requireBuiltin(id)),
    },
    { filename: sharedPath },
  );
  shared.exports.patchDlopen((file) => file.startsWith(snapshot + path.sep));

  return {
    destination,
    opens,
    writes,
    closes,
    renames,
    loads,
    error,
    load: () => fakeProcess.dlopen({}, source),
    seed(bytes: Buffer) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    },
    assertLoaded() {
      assert.deepEqual(loads, [{ file: destination, bytes: content }]);
    },
    assertCache(bytes?: Buffer, extra: string[] = []) {
      assert.deepEqual(
        fs.readdirSync(path.dirname(destination)).sort(),
        [...(bytes ? [path.basename(destination)] : []), ...extra].sort(),
        'no temporary files left behind',
      );
      if (bytes) assert.deepEqual(fs.readFileSync(destination), bytes);
      assert.equal(liveDescriptors.size, 0, 'no leaked descriptors');
    },
    assertStagedWrite() {
      assert.equal(opens.length, 1, 'one exclusive temporary-file open');
      const [{ file, flags, fd }] = opens;
      assert.equal(flags, 'wx');
      assert.notEqual(
        file,
        destination,
        'never open the destination for writing',
      );
      assert.equal(path.dirname(file), path.dirname(destination));
      assert.equal(typeof fd, 'number');
      assert.deepEqual(writes, [fd], 'write only through the temporary fd');
      assert.deepEqual(closes, [fd], 'close the temporary fd exactly once');
      assert.throws(() => fs.fstatSync(fd!), { code: 'EBADF' });
      return file;
    },
    getCollision() {
      assert.ok(collision, 'exclusive open must have been attempted');
      return collision;
    },
  };
}

for (const layout of ['node_modules', 'standalone'] as const) {
  describe(`native addon cache (${layout})`, () => {
    for (const existing of [false, true]) {
      const state = existing ? 'replacement' : 'cold';

      it(`publishes a ${state} cache via a complete sibling file`, (t) => {
        const f = fixture(t, layout);
        if (existing) f.seed(previous);

        assert.equal(f.load(), 'loaded');
        f.assertLoaded();
        const temporary = f.assertStagedWrite();
        assert.deepEqual(f.renames, [
          {
            from: temporary,
            to: f.destination,
            before: existing ? previous : undefined,
          },
        ]);
        f.assertCache(content);
      });

      it(`cleans up a partial ENOSPC write for a ${state} cache`, (t) => {
        const f = fixture(t, layout, { fail: 'write' });
        if (existing) f.seed(previous);

        assert.throws(f.load, (err) => err === f.error);
        assert.deepEqual(f.loads, [], 'must not load after a failed write');
        assert.deepEqual(f.renames, [], 'must not publish partial bytes');
        f.assertCache(existing ? previous : undefined);
        f.assertStagedWrite();
      });

      it(`cleans up a failed rename for a ${state} cache`, (t) => {
        const f = fixture(t, layout, { fail: 'rename' });
        if (existing) f.seed(previous);

        assert.throws(f.load, (err) => err === f.error);
        assert.deepEqual(f.loads, [], 'must not load after a failed rename');
        assert.equal(f.renames.length, 1);
        f.assertCache(existing ? previous : undefined);
        f.assertStagedWrite();
      });
    }

    it('publishes an addon with a 240-byte basename', (t) => {
      // A valid basename near NAME_MAX must not be extended with a temp suffix.
      const filename = `${'a'.repeat(235)}.node`;
      const f = fixture(t, layout, { filename });
      assert.equal(Buffer.byteLength(path.basename(f.destination)), 240);

      assert.equal(f.load(), 'loaded');
      f.assertLoaded();
      const temporary = f.assertStagedWrite();
      assert.ok(Buffer.byteLength(path.basename(temporary)) <= 255);
      assert.deepEqual(f.renames, [
        { from: temporary, to: f.destination, before: undefined },
      ]);
      f.assertCache(content);
    });

    it('uses a fresh sibling filename for each cache repair', (t) => {
      const f = fixture(t, layout);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        f.seed(previous);
        assert.equal(f.load(), 'loaded');
      }

      assert.equal(f.opens.length, 2);
      assert.notEqual(f.opens[0].file, f.opens[1].file);
      for (const { file, flags } of f.opens) {
        assert.equal(flags, 'wx');
        assert.notEqual(file, f.destination);
        assert.equal(path.dirname(file), path.dirname(f.destination));
      }
      assert.equal(f.renames.length, 2);
      f.assertCache(content);
    });

    it('does not write an identical warm cache', (t) => {
      const f = fixture(t, layout);
      f.seed(content);

      assert.equal(f.load(), 'loaded');
      f.assertLoaded();
      assert.deepEqual(f.opens, []);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.closes, []);
      assert.deepEqual(f.renames, []);
      f.assertCache(content);
    });

    for (const matching of [true, false]) {
      it(`${matching ? 'accepts' : 'rejects'} a Windows-style rename race with ${matching ? 'matching' : 'different'} winner bytes`, (t) => {
        const winner = matching ? content : different;
        const f = fixture(t, layout, { fail: 'rename', winner });

        if (matching) {
          assert.equal(f.load(), 'loaded');
          f.assertLoaded();
        } else {
          assert.throws(f.load, (err) => err === f.error);
          assert.deepEqual(f.loads, [], 'must not load a different winner');
        }
        assert.equal(f.renames.length, 1, 'exercise the rename failure');
        f.assertCache(winner);
        f.assertStagedWrite();
      });
    }

    it("does not remove another writer's temporary file on open EEXIST", (t) => {
      const f = fixture(t, layout, { fail: 'open' });
      f.seed(previous);

      assert.throws(f.load, { code: 'EEXIST' });
      const collision = f.getCollision();
      assert.notEqual(collision, f.destination);
      assert.equal(path.dirname(collision), path.dirname(f.destination));
      assert.deepEqual(f.opens, [{ file: collision, flags: 'wx' }]);
      assert.deepEqual(fs.readFileSync(collision), different);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.closes, []);
      assert.deepEqual(f.renames, []);
      assert.deepEqual(f.loads, []);
      f.assertCache(previous, [path.basename(collision)]);
    });
  });
}
