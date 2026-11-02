import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  buildFabricatorRequestChunks,
  checkFabricatorFramePartSize,
  fabricate,
  FABRICATOR_MAX_FRAME_PART_SIZE,
  FABRICATOR_PROTOCOL_EXIT_CODE,
  fabricatorError,
  fabricatorErrorCode,
  fabricatorScript,
  shutdown,
  tryParseFabricatorResponse,
} from '../../lib/fabricator';
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
  // Node never re-emits `exit`/`close` to late subscribers. Resolve on
  // `exit` or `close`, whichever comes first — ending stdin after the
  // child already exited can additionally leave `close` never firing.
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

  // Resolve on `exit` or `close`, whichever comes first. Ending stdin
  // after the child already exited can leave `close` never firing even
  // though the process is gone, so `close` alone is not reliable here.
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

// Decodes every frame with the production parser (not a test-local copy).
function parseAllFrames(buffer: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  let rest = buffer;

  for (;;) {
    const parsed = tryParseFabricatorResponse(rest);

    if (parsed.status === 'incomplete') {
      break;
    }

    if (parsed.status === 'protocol-error') {
      throw new Error(parsed.message);
    }

    frames.push(parsed.frame);
    rest = parsed.remainder;

    if (rest.length === 0) {
      break;
    }
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

const preloadDir = mkdtempSync(path.join(tmpdir(), 'pkg-fabricator-'));

// Bakes are passed to the child before `-e`, so a `--require` preload can
// script misbehaviour into the real fabricator child.
function preloadBakes(name: string, source: string): string[] {
  const file = path.join(preloadDir, `${name}.js`);
  writeFileSync(file, source);
  return ['--require', file];
}

function runFabricate(
  bakes: string[],
  source: string,
  timeoutMs?: number,
): Promise<{ error?: Error; buffer?: Buffer }> {
  return withTimeout(
    new Promise((resolve) => {
      fabricate(
        bakes,
        hostTarget,
        '/snapshot/integration.js',
        Buffer.from(source),
        (error, buffer) => resolve({ error, buffer }),
        timeoutMs,
      );
    }),
    FABRICATE_TIMEOUT_MS,
    'fabricate() response',
  );
}

describe('fabricator framing', () => {
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
    const hBad = Buffer.alloc(4);
    hBad.writeInt32LE(-1, 0);

    const run = await runFabricatorScript([Buffer.concat([h1, snapBuf, hBad])]);

    assert.equal(run.code, FABRICATOR_PROTOCOL_EXIT_CODE);
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
    after(() => {
      shutdown();
      rmSync(preloadDir, { recursive: true, force: true });
    });

    it('covers both halves end to end and reuses the child', async () => {
      for (const source of ['module.exports = 1;', 'module.exports = 2;']) {
        const { error, buffer } = await runFabricate([], source);
        assert.ifError(error);
        assert.ok(buffer && buffer.length > 0);
      }
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
      const bakes = preloadBakes(
        'corrupt-response',
        "require('fs').writeSync(3, 'garbage trace');",
      );
      const { error } = await runFabricate(bakes, 'module.exports = 4;');
      assert.equal(fabricatorErrorCode(error), 'FABRICATOR_PROTOCOL');
    });

    it('times out a child that never answers', async () => {
      const bakes = preloadBakes(
        'never-answers',
        "require('net').Socket.prototype.write = function () { return true; };",
      );
      const { error } = await runFabricate(bakes, 'module.exports = 5;', 200);
      assert.equal(fabricatorErrorCode(error), 'FABRICATOR_TIMEOUT');
    });

    it('reports compile failures as plain, degradable errors', async () => {
      const bakes = preloadBakes(
        'no-cached-data',
        "require('vm').Script = function () { return { cachedDataProduced: false }; };",
      );
      const { error } = await runFabricate(bakes, 'module.exports = 6;');
      assert.ok(error);
      assert.match(error.message, /exit 2/);
      assert.match(error.message, /Cached data not produced/);
      assert.equal(fabricatorErrorCode(error), undefined);
    });
  });

  describe('tryParseFabricatorResponse', () => {
    it('reports incomplete buffers', () => {
      assert.equal(
        tryParseFabricatorResponse(Buffer.alloc(0)).status,
        'incomplete',
      );
      assert.equal(
        tryParseFabricatorResponse(Buffer.alloc(2)).status,
        'incomplete',
      );

      const partial = Buffer.alloc(4);
      partial.writeInt32LE(10, 0);
      assert.deepEqual(tryParseFabricatorResponse(partial), {
        status: 'incomplete',
        needed: 14,
      });
      assert.equal(
        tryParseFabricatorResponse(Buffer.concat([partial, Buffer.alloc(5)]))
          .status,
        'incomplete',
      );
    });

    it('slices one frame and keeps the remainder', () => {
      const blob = Buffer.from([1, 2, 3]);
      const header = Buffer.alloc(4);
      header.writeInt32LE(blob.length, 0);
      const trailing = Buffer.from([9, 9]);
      const parsed = tryParseFabricatorResponse(
        Buffer.concat([header, blob, trailing]),
      );

      assert.equal(parsed.status, 'ok');

      if (parsed.status === 'ok') {
        assert.deepEqual(parsed.frame, blob);
        assert.deepEqual(parsed.remainder, trailing);
      }
    });

    it('decodes zero-length frames', () => {
      const header = Buffer.alloc(4);
      header.writeInt32LE(0, 0);
      const parsed = tryParseFabricatorResponse(header);

      assert.equal(parsed.status, 'ok');

      if (parsed.status === 'ok') {
        assert.equal(parsed.frame.length, 0);
        assert.equal(parsed.remainder.length, 0);
      }
    });

    it('rejects negative and oversize headers', () => {
      const negative = Buffer.alloc(4);
      negative.writeInt32LE(-1, 0);
      const negativeParsed = tryParseFabricatorResponse(negative);
      assert.equal(negativeParsed.status, 'protocol-error');

      const oversize = Buffer.alloc(4);
      oversize.writeInt32LE(FABRICATOR_MAX_FRAME_PART_SIZE + 1, 0);
      const oversizeParsed = tryParseFabricatorResponse(oversize);
      assert.equal(oversizeParsed.status, 'protocol-error');

      // Garbage text on the response stream decodes to an implausible size
      // and must be a protocol error, never a hang or a throw inside the
      // data handler.
      const garbage = Buffer.from('[123:0x5 garbage trace');
      assert.equal(
        tryParseFabricatorResponse(garbage).status,
        'protocol-error',
      );
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
