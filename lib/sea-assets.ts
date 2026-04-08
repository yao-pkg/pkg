import { createReadStream } from 'fs';
import { open, writeFile } from 'fs/promises';
import { join } from 'path';

import {
  STORE_CONTENT,
  STORE_LINKS,
  STORE_STAT,
  replaceSlashes,
  snapshotify,
} from './common';
import { FileRecords, SymLinks } from './types';

export interface SeaManifest {
  entrypoint: string;
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
}

// Normalize a refiner path to a platform-independent POSIX key.
// Reuses replaceSlashes from common.ts which strips the drive letter and
// converts separators on Windows (e.g. 'D:\foo\bar.js' → '/foo/bar.js').
function toPosixKey(p: string): string {
  return replaceSlashes(p, '/');
}

/**
 * Transform walker/refiner output into a single SEA archive blob and manifest.
 *
 * All file contents are concatenated into one binary archive sorted by POSIX
 * key.  The manifest contains an `offsets` map of key → [byteOffset, byteLength]
 * so the runtime can extract individual files via zero-copy Buffer.subarray().
 *
 * Asset keys use refiner paths (no /snapshot prefix) because @platformatic/vfs
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

  const manifest: SeaManifest = {
    // Always use '/' — the bootstrap normalizes for the runtime platform
    entrypoint: snapshotify(entrypoint, '/'),
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

    // Collect file content entry for the archive
    if (record[STORE_CONTENT]) {
      if (record.bodyModified) {
        const content =
          typeof record.body === 'string'
            ? Buffer.from(record.body)
            : record.body!;
        entries.push({ key, source: content });
      } else {
        // Unmodified file — will be streamed from disk
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
        await fd.write(source);
        length = source.length;
      } else {
        // Unmodified file — stream from disk, track actual bytes written
        // (avoids stat→read race if the file changes between calls)
        length = 0;
        const stream = createReadStream(source);
        for await (const chunk of stream) {
          await fd.write(chunk as Buffer);
          length += (chunk as Buffer).length;
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
  };
}
