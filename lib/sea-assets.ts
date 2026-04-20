import { createReadStream } from 'fs';
import {
  FileHandle,
  open,
  readFile as readFileAsync,
  writeFile,
} from 'fs/promises';
import { join } from 'path';
import * as zlib from 'zlib';

import {
  STORE_CONTENT,
  STORE_LINKS,
  STORE_STAT,
  isESMFile,
  replaceSlashes,
  snapshotify,
} from './common';
import { log } from './log';
import { CompressType, getZstdCompressSync } from './compress_type';
import { FileRecords, SymLinks } from './types';

// Normalize a refiner path to a platform-independent POSIX key.
// Strips drive letter and converts separators on Windows
// (e.g. 'D:\\foo\\bar.js' → '/foo/bar.js').
//
// Invariant: callers pass refiner-side snapshot paths (already platform-native
// for the build host). replaceSlashes handles both '/' and '\\' inputs, so this
// is safe whether the caller pre-normalized or not. The output is the canonical
// key shape used everywhere in the manifest.
const toPosixKey = (p: string): string => replaceSlashes(p, '/');

// Write a buffer to fd, looping until the full payload is on disk.
// FileHandle.write may return a short bytesWritten under filesystem pressure;
// we MUST honor it because the manifest offsets are byte-exact and any drift
// would corrupt every file after the short write.
async function writeAll(fd: FileHandle, buf: Buffer): Promise<number> {
  let written = 0;
  while (written < buf.length) {
    const { bytesWritten } = await fd.write(buf, written, buf.length - written);
    if (bytesWritten === 0) {
      throw new Error('pkg: short write to SEA archive blob');
    }
    written += bytesWritten;
  }
  return written;
}

export interface SeaManifest {
  entrypoint: string;
  entryIsESM: boolean;
  directories: Record<string, string[]>;
  stats: Record<
    string,
    { size: number; isFile: boolean; isDirectory: boolean }
  >;
  symlinks: Record<string, string>;
  // [offset, lengthInArchive] — lengthInArchive equals the compressed byte count
  // when `compression` is set, or the raw byte count when it is absent.  The
  // uncompressed size lives in `stats[key].size`.
  offsets: Record<string, [number, number]>;
  // Numeric CompressType value.  Absent means uncompressed (backward compat).
  compression?: number;
  debug?: boolean;
}

/**
 * Resolve the per-codec sync compressor once, up front.  Sync compression is
 * fine here: each file is MB-scale at worst, the archive build is offline,
 * and plumbing a stream through `writeAll` would buy negligible real-world
 * benefit.  Zstd resolution routes through compress_type.ts's zstdBuildError
 * so build-time missing-API wording stays consistent with producer.ts.
 */
function resolveCompressor(type: CompressType): (buf: Buffer) => Buffer {
  switch (type) {
    case CompressType.None:
      return (buf) => buf;
    case CompressType.GZip:
      return zlib.gzipSync;
    case CompressType.Brotli:
      return zlib.brotliCompressSync;
    case CompressType.Zstd:
      return getZstdCompressSync();
    default: {
      // Exhaustiveness: adding a new CompressType without wiring it here
      // would otherwise emit a manifest that claims compression with raw
      // payload, producing a cryptic runtime error instead of a clear build
      // failure.
      const exhaustive: never = type;
      throw new Error(`pkg: unsupported CompressType ${exhaustive}`);
    }
  }
}

export interface SeaAssetsResult {
  assets: Record<string, string>;
  manifestPath: string;
}

/**
 * Transform walker/refiner output into a single SEA archive blob and manifest.
 *
 * All file contents are concatenated into one binary archive sorted by POSIX
 * key.  The manifest contains an `offsets` map of key → [byteOffset, byteLength]
 * so the runtime can extract individual files via zero-copy Buffer.subarray().
 *
 * Asset keys use refiner paths (no /snapshot prefix) because @roberts_lando/vfs
 * strips the mount prefix before passing paths to the provider. The entrypoint
 * in the manifest uses the snapshotified path for process.argv[1] compatibility.
 *
 * Always uses POSIX '/' separator for manifest paths so the same blob works
 * regardless of build platform. The bootstrap normalizes at runtime.
 */
export async function generateSeaAssets(
  records: FileRecords,
  entrypoint: string,
  symLinks: SymLinks,
  tmpDir: string,
  options?: { debug?: boolean; doCompress?: CompressType },
): Promise<SeaAssetsResult> {
  const doCompress = options?.doCompress ?? CompressType.None;
  const isCompressing = doCompress !== CompressType.None;
  // Resolve the compressor (or throw with a clear error) BEFORE we start
  // writing any stripes, so a host missing zlib.zstdCompressSync fails
  // immediately instead of mid-archive.
  const compress = isCompressing ? resolveCompressor(doCompress) : null;
  // Normalize symlink paths to use the same refiner-style POSIX keys as
  // directories/stats/assets. Do not add the /snapshot prefix because the
  // VFS provider receives paths after the mount prefix is stripped.
  const normalizedSymlinks: Record<string, string> = {};
  for (const src in symLinks) {
    normalizedSymlinks[toPosixKey(src)] = toPosixKey(symLinks[src]);
  }

  // Detect if entrypoint is ESM via its real disk path
  const entryRecord = records[entrypoint];
  const entryIsESM = entryRecord
    ? isESMFile(entryRecord.file)
    : isESMFile(entrypoint);

  const manifest: SeaManifest = {
    // Always use '/' — the bootstrap normalizes for the runtime platform
    entrypoint: snapshotify(entrypoint, '/'),
    entryIsESM,
    directories: {},
    stats: {},
    symlinks: normalizedSymlinks,
    offsets: {},
    ...(isCompressing ? { compression: doCompress } : {}),
    ...(options?.debug ? { debug: true } : {}),
  };

  // First pass: collect file entries and build manifest metadata
  const entries: { key: string; source: Buffer | string }[] = [];

  for (const snap in records) {
    if (!records[snap]) continue;
    const record = records[snap];
    const key = toPosixKey(snap);

    // Collect file content entry for the archive.
    //
    // Prefer the in-memory body when present, fall back to disk streaming
    // only when body was never loaded. This is safe because of an
    // invariant maintained by walker.ts in SEA mode:
    //
    //   if (record.body != null) then it equals the bytes we want to
    //   ship — either the original disk content (when stepRead loaded
    //   it and nothing modified it) or an intentional rewrite (patches,
    //   stripped shebang/BOM, package.json synthetic main, etc.).
    //
    // The ESM→CJS transform and `type: module → commonjs` rewrite are
    // the only mutations that could diverge body from disk, and both
    // are gated on `!seaMode` in walker.ts — so they never run here.
    //
    // Trusting the in-memory body has two upsides over re-streaming:
    //   1. Avoids a redundant second read of every JS file (walker
    //      already paid the I/O for strip/detect).
    //   2. Race-safe: if a source file is modified mid-build, the
    //      bytes we ship match the bytes walker scanned for require()
    //      calls — detected deps cannot mismatch shipped content.
    if (record[STORE_CONTENT]) {
      if (record.body != null) {
        const content =
          typeof record.body === 'string'
            ? Buffer.from(record.body)
            : record.body;
        entries.push({ key, source: content });
      } else {
        // body never loaded — stream straight from disk without
        // pulling it through memory.
        entries.push({ key, source: record.file });
      }
    }

    // Collect directory entries
    if (record[STORE_LINKS]) {
      manifest.directories[key] = [...new Set(record[STORE_LINKS] as string[])];
    }

    // Collect stat metadata
    if (record[STORE_STAT]) {
      const s = record[STORE_STAT];
      manifest.stats[key] = {
        size: s.size ?? 0,
        isFile: Boolean(s.isFileValue),
        isDirectory: Boolean(s.isDirectoryValue),
      };
    }
  }

  // Sort entries by key for deterministic archive output
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // Stream-write the single archive blob
  const archivePath = join(tmpDir, '__pkg_archive__');
  const fd = await open(archivePath, 'w');
  let offset = 0;

  // Debug-mode running totals for per-stripe compression stats
  let totalUncompressed = 0;
  let totalCompressed = 0;

  try {
    for (const { key, source } of entries) {
      let uncompressedLen: number;
      let length: number;

      if (compress) {
        // Compression needs the full content in memory to feed zlib.*Sync.
        const raw = Buffer.isBuffer(source)
          ? source
          : await readFileAsync(source);
        uncompressedLen = raw.length;
        const payload = compress(raw);
        length = await writeAll(fd, payload);

        totalUncompressed += uncompressedLen;
        totalCompressed += length;
        if (options?.debug) {
          const ratio = uncompressedLen
            ? ((length / uncompressedLen) * 100).toFixed(1)
            : '0.0';
          log.debug(
            `sea-stripe ${key}: ${uncompressedLen} → ${length} bytes (${ratio}%)`,
          );
        }
      } else if (Buffer.isBuffer(source)) {
        // Modified file content already in memory.
        length = await writeAll(fd, source);
        uncompressedLen = length;
      } else {
        // Unmodified disk-resident file — stream chunk-by-chunk so peak RSS
        // stays bounded when packaging large asset sets.  Accumulate actual
        // bytes written (avoids stat→read race if the file changes between
        // calls).
        length = 0;
        const stream = createReadStream(source);
        for await (const chunk of stream) {
          length += await writeAll(fd, chunk as Buffer);
        }
        uncompressedLen = length;
      }

      manifest.offsets[key] = [offset, length];

      // `stats[key].size` must report the uncompressed size — that is what
      // user code sees from fs.statSync() AND what the runtime uses to cap
      // zlib output and validate the decompressed length.  Synthesize a
      // minimal file stat when the record had no STORE_STAT so every entry
      // with content has an authoritative size.
      if (manifest.stats[key]) {
        manifest.stats[key].size = uncompressedLen;
      } else {
        manifest.stats[key] = {
          size: uncompressedLen,
          isFile: true,
          isDirectory: false,
        };
      }

      offset += length;
    }
  } finally {
    await fd.close();
  }

  if (isCompressing) {
    const ratio = totalUncompressed
      ? ((totalCompressed / totalUncompressed) * 100).toFixed(1)
      : '0.0';
    log.info(
      `SEA archive compressed with ${CompressType[doCompress]}: ${totalUncompressed} → ${totalCompressed} bytes (${ratio}%)`,
    );
  }

  const manifestPath = join(tmpDir, '__pkg_manifest__.json');
  await writeFile(manifestPath, JSON.stringify(manifest));

  return {
    assets: { __pkg_archive__: archivePath },
    manifestPath,
  };
}
