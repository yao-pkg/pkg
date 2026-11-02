import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  buildFabricatorRequestChunks,
  checkFabricatorFramePartSize,
  fabricate,
  fabricateTwice,
  FABRICATOR_MAX_FRAME_PART_SIZE,
  FABRICATOR_PROTOCOL_EXIT_CODE,
  fabricatorError,
  fabricatorErrorCode,
  fabricatorScript,
  shutdown,
} from '../../lib/fabricator';
import { STORE_BLOB } from '../../lib/common';
import { CompressType } from '../../lib/compress_type';
import producer from '../../lib/producer';
import { Target } from '../../lib/types';

const CHILD_CLOSE_TIMEOUT_MS = 30 * 1000;
const FABRICATE_TIMEOUT_MS = 60 * 1000;
// Long enough that the child processes each staged write as its own `data`
// event instead of coalescing them.
const WRITE_GAP_MS = 50;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${label}`)),
      ms,
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

interface ChildRun {
  code: number | null;
  response: Buffer;
  stderr: string;
}

// Writes each chunk with a delay in between so chunk boundaries survive to
// the child as separate `data` events, then ends stdin with the tail.
async function runFabricatorScript(
  writes: Buffer[],
  endChunk?: Buffer,
): Promise<ChildRun> {
  const child = spawn(process.execPath, ['-e', fabricatorScript], {
    stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
  });

  const responseChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  (child.stdio[3] as Readable).on('data', (chunk: Buffer) => {
    responseChunks.push(chunk);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  // Attach before any await: a child that exits during the staged writes
  // below may fully tear down before a later-attached listener runs, and
  // Node never re-emits `exit`/`close` to late subscribers.
  const closePromise = new Promise<number | null>((resolve) => {
    child.once('exit', (exitCode) => resolve(exitCode));
    child.once('close', (closeCode) => resolve(closeCode));
    child.once('error', () => resolve(null));
  });

  for (const write of writes) {
    child.stdin.write(write);
    await delay(WRITE_GAP_MS);
  }

  if (endChunk) {
    child.stdin.end(endChunk);
  } else {
    child.stdin.end();
  }

  // `exit` or `close`, whichever comes first: ending stdin after the child
  // exited can leave `close` never firing.
  const code = await withTimeout(
    closePromise,
    CHILD_CLOSE_TIMEOUT_MS,
    'fabricator child close',
  );

  return {
    code,
    response: Buffer.concat(responseChunks),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
}

function parseAllFrames(buffer: Buffer): Buffer[] {
  const frames: Buffer[] = [];

  for (let offset = 0; offset + 4 <= buffer.length; ) {
    const size = buffer.readInt32LE(offset);
    frames.push(buffer.subarray(offset + 4, offset + 4 + size));
    offset += 4 + size;
  }

  return frames;
}

function frameFor(snap: string, source: string): Buffer {
  return Buffer.concat(buildFabricatorRequestChunks(snap, Buffer.from(source)));
}

const hostTarget = {
  nodeRange: 'node22',
  arch: 'x64',
  platform: 'linux',
  binaryPath: process.execPath,
  output: '',
  fabricator: undefined,
} as unknown as Target;

// Preload snippets; fd 3 is the child's response pipe.
const CORRUPT_RESPONSE = "require('fs').writeSync(3, 'garbage trace');";
const NO_CACHED_DATA =
  "require('vm').Script = function () { return { cachedDataProduced: false }; };";

const preloadDir = mkdtempSync(path.join(tmpdir(), 'pkg-fabricator-'));

// Bakes are passed to the child before `-e`, so a `--require` preload can
// script misbehaviour into the real fabricator child.
function preloadBakes(name: string, source: string): string[] {
  const file = path.join(preloadDir, `${name}.js`);
  writeFileSync(file, source);
  return ['--require', file];
}

// Counts spawns so tests can observe retries and respawns; with
// `firstSpawnOnly` the misbehaviour runs in the first child only.
function countedBakes(
  name: string,
  source: string,
  firstSpawnOnly: boolean,
): { bakes: string[]; spawns: () => number } {
  const marker = path.join(preloadDir, `${name}.spawns`);
  const guard = firstSpawnOnly
    ? `!require('fs').existsSync(${JSON.stringify(marker)})`
    : 'true';
  const bakes = preloadBakes(
    name,
    `var misbehave = ${guard};
    require('fs').appendFileSync(${JSON.stringify(marker)}, 'x');
    if (misbehave) { ${source} }`,
  );
  return {
    bakes,
    spawns: () =>
      existsSync(marker) ? readFileSync(marker, 'utf8').length : 0,
  };
}

function runFabricate(
  bakes: string[],
  source: string,
  { timeoutMs, twice = false }: { timeoutMs?: number; twice?: boolean } = {},
): Promise<{ error?: Error; buffer?: Buffer }> {
  return withTimeout(
    new Promise((resolve) => {
      const cb = (error?: Error, buffer?: Buffer) => resolve({ error, buffer });
      const snap = '/snapshot/integration.js';

      if (twice) {
        fabricateTwice(bakes, hostTarget, snap, Buffer.from(source), cb);
      } else {
        fabricate(bakes, hostTarget, snap, Buffer.from(source), cb, timeoutMs);
      }
    }),
    FABRICATE_TIMEOUT_MS,
    'fabricate() response',
  );
}

describe('fabricator framing', () => {
  after(() => {
    shutdown();
    rmSync(preloadDir, { recursive: true, force: true });
  });

  it('buildFabricatorRequestChunks uses independent headers', () => {
    const body = Buffer.from('module.exports = 42;');
    const [h1, snapBuf, h2, bodyBuf] = buildFabricatorRequestChunks(
      '/snapshot/app.js',
      body,
    );

    assert.notEqual(h1, h2);
    assert.equal(h1.readInt32LE(0), snapBuf.length);
    assert.equal(h2.readInt32LE(0), bodyBuf.length);

    h2.writeInt32LE(123456, 0);
    assert.equal(h1.readInt32LE(0), snapBuf.length);
  });

  it('child script preserves trailing bytes and decodes multiple payloads', async () => {
    const frame1 = frameFor('/snapshot/one.js', 'module.exports = 1;');
    const frame2 = frameFor('/snapshot/two.js', 'module.exports = 2;');

    // Split offsets inside the size header, straddling it, and late in the
    // frame. Each offset runs in its own child so staged writes cannot
    // coalesce and the partial-header resume path must execute.
    const splitOffsets = [1, 3, 4, 5, 9, frame2.length - 1];

    for (const splitAt of splitOffsets) {
      const run = await runFabricatorScript(
        [frame1, frame2.subarray(0, splitAt)],
        frame2.subarray(splitAt),
      );

      assert.equal(run.code, 0, `splitAt=${splitAt}: ${run.stderr}`);

      const frames = parseAllFrames(run.response);
      assert.equal(frames.length, 2, `splitAt=${splitAt}`);
      assert.ok(frames[0].length > 0, `splitAt=${splitAt}`);
      assert.ok(frames[1].length > 0, `splitAt=${splitAt}`);
    }
  });

  it('child script rejects invalid snap size headers', async () => {
    const cases: Array<[string, number]> = [
      ['negative', -1],
      ['oversize', FABRICATOR_MAX_FRAME_PART_SIZE + 1],
    ];

    for (const [name, size] of cases) {
      const badHeader = Buffer.alloc(4);
      badHeader.writeInt32LE(size, 0);

      const run = await runFabricatorScript([badHeader]);

      // Exit code alone proves the guard fired and distinguishes the
      // framing path from every compile-failure path (exit 2). The stderr
      // text is intentionally not asserted: a piped write immediately
      // before exit can truncate on some platforms.
      assert.equal(run.code, FABRICATOR_PROTOCOL_EXIT_CODE, name);
    }
  });

  it('child script rejects invalid body size headers', async () => {
    // A valid snap prefix proves the *body* guard fired: the snap guard
    // already passed, so only the body header check can exit non-zero here.
    const snap = '/snapshot/two.js';
    const snapBuf = Buffer.from(snap);
    const h1 = Buffer.alloc(4);
    h1.writeInt32LE(snapBuf.length, 0);
    for (const size of [-1, FABRICATOR_MAX_FRAME_PART_SIZE + 1]) {
      const hBad = Buffer.alloc(4);
      hBad.writeInt32LE(size, 0);

      const run = await runFabricatorScript([
        Buffer.concat([h1, snapBuf, hBad]),
      ]);

      assert.equal(run.code, FABRICATOR_PROTOCOL_EXIT_CODE, String(size));
    }
  });

  it('child script compiles zero-length snap and body payloads', async () => {
    const run = await runFabricatorScript([
      frameFor('', 'module.exports = 1;'),
      frameFor('/snapshot/empty.js', ''),
    ]);

    assert.equal(run.code, 0, run.stderr);

    const frames = parseAllFrames(run.response);
    assert.equal(frames.length, 2);
  });

  describe('fabricate()', () => {
    it('covers both halves end to end and reuses the child', async () => {
      const { bakes, spawns } = countedBakes('reuse', '', false);

      for (const source of ['module.exports = 1;', 'module.exports = 2;']) {
        const { error, buffer } = await runFabricate(bakes, source);
        assert.ifError(error);
        assert.ok(buffer && buffer.length > 0);
      }

      assert.equal(spawns(), 1);
    });

    it('ignores V8 trace output on stdout', async () => {
      const bakes = preloadBakes(
        'stdout-noise',
        "process.stdout.write('[123:0x5] Scavenge 1.0 -> 0.9 MB\\n');",
      );
      const { error, buffer } = await runFabricate(
        bakes,
        'module.exports = 3;',
      );
      assert.ifError(error);
      assert.ok(buffer && buffer.length > 0);
    });

    it('fails with a protocol error on a corrupt response', async () => {
      // Trace text decodes to an oversize header; 0xff bytes to a negative one.
      const cases = {
        'corrupt-response': CORRUPT_RESPONSE,
        'negative-header': "require('fs').writeSync(3, Buffer.alloc(4, 0xff));",
      };

      for (const [name, source] of Object.entries(cases)) {
        const { error } = await runFabricate(
          preloadBakes(name, source),
          'module.exports = 4;',
        );
        assert.equal(fabricatorErrorCode(error), 'FABRICATOR_PROTOCOL', name);
      }
    });

    it('reassembles a response split across chunks', async () => {
      const sent = path.join(preloadDir, 'split-response.blob');

      // Header and blob are re-sent in delayed pieces: inside the header,
      // then inside the blob, so the parent must wait twice.
      const bakes = preloadBakes(
        'split-response',
        `var net = require('net');
        var write = net.Socket.prototype.write;
        var header;
        net.Socket.prototype.write = function (chunk) {
          if (!header) { header = chunk; return true; }
          var self = this;
          var frame = Buffer.concat([header, chunk]);
          require('fs').writeFileSync(${JSON.stringify(sent)}, chunk);
          var cuts = [0, 2, 4 + (chunk.length >> 1), frame.length];
          header = undefined;
          cuts.slice(1).forEach(function (end, i) {
            setTimeout(function () {
              write.call(self, frame.subarray(cuts[i], end));
            }, 30 * i);
          });
          return true;
        };`,
      );
      const split = await runFabricate(bakes, 'module.exports = "split";');
      assert.ifError(split.error);
      assert.deepEqual(split.buffer, readFileSync(sent));
    });

    it('times out a child that never answers, then respawns', async () => {
      const { bakes, spawns } = countedBakes(
        'never-answers',
        "require('net').Socket.prototype.write = function () { return true; };",
        true,
      );
      const { error } = await runFabricate(bakes, 'module.exports = 5;', {
        timeoutMs: 200,
      });
      assert.equal(fabricatorErrorCode(error), 'FABRICATOR_TIMEOUT');

      const retry = await runFabricate(bakes, 'module.exports = 5;');
      assert.ifError(retry.error);
      assert.equal(spawns(), 2);
    });

    it('maps child exit 65 to a protocol error', async () => {
      const bakes = preloadBakes(
        'exit-65',
        `process.stdin.on('data', function () { process.exit(${FABRICATOR_PROTOCOL_EXIT_CODE}); });`,
      );
      // Larger than a pipe buffer, so the parent is still writing when the
      // child exits and stdin fails with EPIPE first.
      const { error } = await runFabricate(
        bakes,
        `module.exports = '${'x'.repeat(1024 * 1024)}';`,
      );
      assert.equal(fabricatorErrorCode(error), 'FABRICATOR_PROTOCOL');
    });

    it('fails with a protocol error on bytes after the response', async () => {
      // Header and blob go out in one write with a trailing byte, so the
      // parent sees them in a single chunk.
      const bakes = preloadBakes(
        'trailing-bytes',
        `var net = require('net');
        var write = net.Socket.prototype.write;
        var header;
        net.Socket.prototype.write = function (chunk) {
          if (!header) { header = chunk; return true; }
          return write.call(this, Buffer.concat([header, chunk, Buffer.from('x')]));
        };`,
      );
      const { error } = await runFabricate(bakes, 'module.exports = 8;');
      assert.equal(fabricatorErrorCode(error), 'FABRICATOR_PROTOCOL');
      assert.match(error!.message, /1 unexpected bytes after response/);
    });

    it('restarts a child that writes with no request pending', async () => {
      const written = path.join(preloadDir, 'unsolicited.written');
      const { bakes, spawns } = countedBakes(
        'unsolicited',
        `process.stdin.once('data', function () {
          setTimeout(function () {
            // Marker first: the parent kills this child on the stray bytes.
            require('fs').writeFileSync(${JSON.stringify(written)}, '');
            require('fs').writeSync(3, 'late');
          }, 20);
        });`,
        true,
      );
      const first = await runFabricate(bakes, 'module.exports = 9;');
      assert.ifError(first.error);

      // Wait for the child to have written, then for the parent to read it.
      while (!existsSync(written)) await delay(10);
      await delay(100);

      const second = await runFabricate(bakes, 'module.exports = 9;');
      assert.ifError(second.error);
      assert.equal(spawns(), 2);
    });

    it('fabricateTwice retries plain failures once', async () => {
      const { bakes, spawns } = countedBakes('fail-once', NO_CACHED_DATA, true);
      const { error, buffer } = await runFabricate(
        bakes,
        'module.exports = 10;',
        { twice: true },
      );
      assert.ifError(error);
      assert.ok(buffer && buffer.length > 0);
      assert.equal(spawns(), 2);
    });

    it('fabricateTwice never retries coded failures', async () => {
      const { bakes, spawns } = countedBakes(
        'corrupt-always',
        CORRUPT_RESPONSE,
        false,
      );
      const { error } = await runFabricate(bakes, 'module.exports = 11;', {
        twice: true,
      });
      assert.equal(fabricatorErrorCode(error), 'FABRICATOR_PROTOCOL');
      assert.equal(spawns(), 1);
    });

    it('reports compile failures as plain, degradable errors', async () => {
      const bakes = preloadBakes('no-cached-data', NO_CACHED_DATA);
      const { error } = await runFabricate(bakes, 'module.exports = 6;');
      assert.ok(error);
      assert.match(error.message, /exit 2/);
      assert.match(error.message, /Cached data not produced/);
      assert.equal(fabricatorErrorCode(error), undefined);
    });
  });

  describe('producer()', () => {
    // Just enough of a base binary for producer to find its placeholders.
    const baseBinary = path.join(preloadDir, 'base-binary');
    writeFileSync(
      baseBinary,
      `\0${'// BAKERY '.repeat(20)}\0` +
        '// PAYLOAD_POSITION // // PAYLOAD_SIZE // ' +
        '// PRELUDE_POSITION // // PRELUDE_SIZE // ',
    );

    function produce(bakes: string[], name: string, source: string) {
      const output = path.join(preloadDir, `${name}.out`);
      const target = {
        ...hostTarget,
        binaryPath: baseBinary,
        output,
        fabricator: hostTarget,
      } as unknown as Target;

      return {
        output,
        done: producer({
          backpack: {
            prelude: '',
            entrypoint: '/app/index.js',
            stripes: [
              {
                snap: '/app/index.js',
                store: STORE_BLOB,
                buffer: Buffer.from(source),
              },
            ],
          },
          bakes,
          slash: '/',
          target,
          symLinks: {},
          doCompress: CompressType.None,
          nativeBuild: false,
          fallbackToSource: true,
        }),
      };
    }

    it('aborts on a protocol error even with --fallback-to-source', async () => {
      const bakes = preloadBakes('producer-desync', CORRUPT_RESPONSE);
      const { output, done } = produce(bakes, 'desync', 'module.exports = 12;');
      await assert.rejects(
        done,
        (error: Error & { wasReported?: boolean }) =>
          error.wasReported === true && /channel desynced/.test(error.message),
      );
      assert.equal(existsSync(output), false, 'partial output removed');
    });

    it('falls back to source on a compile failure', async () => {
      const bakes = preloadBakes('producer-compile-failure', NO_CACHED_DATA);
      const source = 'module.exports = "fallback-marker";';
      const { output, done } = produce(bakes, 'fallback', source);
      await done;
      assert.ok(readFileSync(output).includes(source));
    });
  });

  describe('frame size limits', () => {
    it('accepts payloads at the ceiling without allocating it', () => {
      checkFabricatorFramePartSize('snap', FABRICATOR_MAX_FRAME_PART_SIZE);
      checkFabricatorFramePartSize('body', FABRICATOR_MAX_FRAME_PART_SIZE);
      assert.equal(fabricatorErrorCode(new Error('other')), undefined);
    });

    it('tags oversize payloads so they are not retried', () => {
      for (const label of ['snap', 'body'] as const) {
        assert.throws(
          () =>
            checkFabricatorFramePartSize(
              label,
              FABRICATOR_MAX_FRAME_PART_SIZE + 1,
            ),
          /exceeds max frame size/,
        );
      }

      try {
        checkFabricatorFramePartSize(
          'body',
          FABRICATOR_MAX_FRAME_PART_SIZE + 1,
        );
        assert.fail('expected checkFabricatorFramePartSize to throw');
      } catch (error) {
        assert.equal(
          fabricatorErrorCode(error as Error),
          'FABRICATOR_FRAME_TOO_LARGE',
        );
      }
    });
  });

  describe('fabricatorErrorCode', () => {
    it('recognises only fabricator codes', () => {
      const error = fabricatorError('FABRICATOR_PROTOCOL', 'desynced');
      assert.equal(fabricatorErrorCode(error), 'FABRICATOR_PROTOCOL');

      const other = new Error('other');
      (other as NodeJS.ErrnoException).code = 'ENOENT';
      assert.equal(fabricatorErrorCode(other), undefined);
      assert.equal(fabricatorErrorCode(undefined), undefined);
    });
  });
});
