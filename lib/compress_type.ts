import * as zlib from 'zlib';
import type { Transform } from 'stream';

import { wasReported } from './log';

export enum CompressType {
  None = 0,
  GZip = 1,
  Brotli = 2,
  Zstd = 3,
}

// Node.js gained Zstd zlib bindings in 22.15.  The TypeScript zlib typings do
// not yet expose them, so we reach for the symbol through an untyped cast and
// raise a uniformly-worded error when it is missing.  Keep the message here so
// build-time callers (producer.ts, sea-assets.ts) don't drift.
const ZSTD_MISSING_BUILD_REMEDIATION =
  'Upgrade the build host to Node.js >= 22.15, or pick --compress Brotli / GZip.';

function zstdBuildError(symbol: string): Error {
  return wasReported(
    `Zstd compression requires Node.js >= 22.15 (host runtime missing zlib.${symbol}, current: ${process.version}). ` +
      ZSTD_MISSING_BUILD_REMEDIATION,
  );
}

type ZlibZstd = {
  zstdCompressSync?: (b: Buffer) => Buffer;
  createZstdCompress?: () => Transform;
};

export function getZstdCompressSync(): (b: Buffer) => Buffer {
  const fn = (zlib as unknown as ZlibZstd).zstdCompressSync;
  if (typeof fn !== 'function') {
    throw zstdBuildError('zstdCompressSync');
  }
  return fn;
}

export function getZstdCompressStream(): () => Transform {
  const fn = (zlib as unknown as ZlibZstd).createZstdCompress;
  if (typeof fn !== 'function') {
    throw zstdBuildError('createZstdCompress');
  }
  return fn;
}
