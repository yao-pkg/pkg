import assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import { describe, it } from 'node:test';

import {
  CompressType,
  getZstdCompressSync,
  getZstdCompressStream,
} from '../../lib/compress_type';

// The enum is serialized into pkg prelude (see prelude/bootstrap.js) and
// compared against bytes in the packed binary. Changing these numeric values
// silently breaks every pre-existing binary, so lock them in.
describe('CompressType enum', () => {
  it('has a stable numeric layout', () => {
    assert.equal(CompressType.None, 0);
    assert.equal(CompressType.GZip, 1);
    assert.equal(CompressType.Brotli, 2);
    assert.equal(CompressType.Zstd, 3);
  });
});

// Zstd landed in Node's zlib in 22.15. The accessor pair has two jobs:
// return the bound function when available, and throw a uniformly-worded
// error otherwise so producer.ts and sea-assets.ts share the same message.
const zstdAvailable =
  typeof (zlib as { zstdCompressSync?: unknown }).zstdCompressSync ===
  'function';

describe('getZstdCompressSync', { skip: !zstdAvailable }, () => {
  it('returns the bound zlib.zstdCompressSync function', () => {
    const fn = getZstdCompressSync();
    assert.equal(typeof fn, 'function');
    assert.equal(
      fn,
      (zlib as unknown as { zstdCompressSync: typeof fn }).zstdCompressSync,
    );
  });
});

describe('getZstdCompressSync (missing)', { skip: zstdAvailable }, () => {
  it('throws a Node-version message', () => {
    assert.throws(
      () => getZstdCompressSync(),
      /Zstd compression requires Node\.js >= 22\.15/,
    );
  });
});

const createZstdAvailable =
  typeof (zlib as { createZstdCompress?: unknown }).createZstdCompress ===
  'function';

describe('getZstdCompressStream', { skip: !createZstdAvailable }, () => {
  it('returns the bound zlib.createZstdCompress function', () => {
    const fn = getZstdCompressStream();
    assert.equal(typeof fn, 'function');
    assert.equal(
      fn,
      (zlib as unknown as { createZstdCompress: typeof fn }).createZstdCompress,
    );
  });
});

describe(
  'getZstdCompressStream (missing)',
  { skip: createZstdAvailable },
  () => {
    it('throws a Node-version message', () => {
      assert.throws(
        () => getZstdCompressStream(),
        /Zstd compression requires Node\.js >= 22\.15/,
      );
    });
  },
);
