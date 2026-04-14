import { createReadStream } from 'fs';
import { FileHandle, open, writeFile } from 'fs/promises';
import { join } from 'path';

import {
  STORE_CONTENT,
  STORE_LINKS,
  STORE_STAT,
  isESMFile,
  replaceSlashes,
  snapshotify,
} from './common';
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
  offsets: Record<string, [number, number]>;
  debug?: boolean;
}

export interface SeaAssetsResult {
  assets: Record<string, string>;
  manifestPath: string;
  entryIsESM: boolean;
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
  options?: { debug?: boolean },
): Promise<SeaAssetsResult> {
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

  try {
    for (const { key, source } of entries) {
      let length: number;
      if (Buffer.isBuffer(source)) {
        // Modified file content already in memory
        length = await writeAll(fd, source);
      } else {
        // Unmodified file — stream from disk, accumulate actual bytes
        // written (avoids stat→read race if the file changes between calls)
        length = 0;
        const stream = createReadStream(source);
        for await (const chunk of stream) {
          length += await writeAll(fd, chunk as Buffer);
        }
      }
      manifest.offsets[key] = [offset, length];
      // Fix manifest stat size to reflect actual content for modified files
      if (manifest.stats[key]) {
        manifest.stats[key].size = length;
      }
      offset += length;
    }
  } finally {
    await fd.close();
  }

  const manifestPath = join(tmpDir, '__pkg_manifest__.json');
  await writeFile(manifestPath, JSON.stringify(manifest));

  return {
    assets: { __pkg_archive__: archivePath },
    manifestPath,
    entryIsESM,
  };
}
