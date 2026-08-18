import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import {
  buildFabricatorRequestChunks,
  fabricatorScript,
} from '../../lib/fabricator';

function parseBlobFrames(buffer: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const sizeOfBlob = buffer.readInt32LE(offset);
    if (sizeOfBlob < 0 || offset + 4 + sizeOfBlob > buffer.length) break;

    const blob = Buffer.alloc(sizeOfBlob);
    buffer.copy(blob, 0, offset + 4, offset + 4 + sizeOfBlob);
    out.push(blob);
    offset += 4 + sizeOfBlob;
  }

  return out;
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
    const child = spawn(process.execPath, ['-e', fabricatorScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const frame1 = Buffer.concat(
      buildFabricatorRequestChunks(
        '/snapshot/one.js',
        Buffer.from('module.exports = 1;'),
      ),
    );
    const frame2 = Buffer.concat(
      buildFabricatorRequestChunks(
        '/snapshot/two.js',
        Buffer.from('module.exports = 2;'),
      ),
    );

    const splitAt = 3;
    child.stdin.write(Buffer.concat([frame1, frame2.subarray(0, splitAt)]));
    child.stdin.end(frame2.subarray(splitAt));

    const [code] = (await new Promise((resolve) => {
      child.on('close', (closeCode, signal) => resolve([closeCode, signal]));
    })) as [number | null, NodeJS.Signals | null];

    assert.equal(code, 0, Buffer.concat(stderrChunks).toString());

    const frames = parseBlobFrames(Buffer.concat(stdoutChunks));
    assert.equal(frames.length, 2);
    assert.ok(frames[0].length > 0);
    assert.ok(frames[1].length > 0);
  });

  it('child script rejects invalid size headers', async () => {
    const child = spawn(process.execPath, ['-e', fabricatorScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const badHeader = Buffer.alloc(4);
    badHeader.writeInt32LE(-1, 0);
    child.stdin.end(badHeader);

    const [code] = (await new Promise((resolve) => {
      child.on('close', (closeCode, signal) => resolve([closeCode, signal]));
    })) as [number | null, NodeJS.Signals | null];

    const stderr = Buffer.concat(stderrChunks).toString();
    assert.equal(code, 2);
    assert.match(stderr, /Invalid snap size header/);
  });
});
