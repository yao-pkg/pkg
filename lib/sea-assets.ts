import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { STORE_CONTENT, STORE_LINKS, STORE_STAT, snapshotify } from './common';
import { FileRecords, SymLinks } from './types';

export interface SeaManifest {
  entrypoint: string;
  directories: Record<string, string[]>;
  stats: Record<
    string,
    { size: number; isFile: boolean; isDirectory: boolean }
  >;
  symlinks: Record<string, string>;
  debug?: boolean;
}

export interface SeaAssetsResult {
  assets: Record<string, string>;
  manifestPath: string;
}

// Normalize a refiner path to a platform-independent POSIX key.
// On Windows the refiner keeps the drive letter (e.g. 'D:\foo\bar.js');
// we strip it and convert separators so all manifest/asset keys are POSIX
// (e.g. '/foo/bar.js') — the bootstrap normalises VFS-received paths to
// the same format before lookup.
function toPosixKey(p: string): string {
  if (process.platform === 'win32') {
    return p.slice(2).replace(/\\/g, '/');
  }
  return p;
}

/**
 * Transform walker/refiner output into SEA-compatible asset map and manifest.
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
  const assets: Record<string, string> = {};

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
    ...(options?.debug ? { debug: true } : {}),
  };

  let modifiedFileCount = 0;

  for (const snap in records) {
    if (!records[snap]) continue;
    const record = records[snap];
    const key = toPosixKey(snap);

    // Map file content to SEA asset
    if (record[STORE_CONTENT]) {
      if (record.body != null) {
        // File was modified (patches, rewrites) — write to temp file
        const tempPath = join(
          tmpDir,
          'assets',
          `modified_${modifiedFileCount}`,
        );
        modifiedFileCount += 1;
        await mkdir(dirname(tempPath), { recursive: true });
        const content =
          typeof record.body === 'string'
            ? Buffer.from(record.body)
            : record.body;
        await writeFile(tempPath, content);
        assets[key] = tempPath;
      } else {
        // Unmodified file — point to source on disk
        assets[key] = record.file;
      }
    }

    // Collect directory entries
    if (record[STORE_LINKS]) {
      manifest.directories[key] = [...new Set(record[STORE_LINKS] as string[])];
    }

    // Collect stat metadata
    if (record[STORE_STAT]) {
      const stat = record[STORE_STAT];
      manifest.stats[key] = {
        size: stat.size ?? 0,
        isFile: Boolean(stat.isFileValue),
        isDirectory: Boolean(stat.isDirectoryValue),
      };
    }
  }

  const manifestPath = join(tmpDir, '__pkg_manifest__.json');
  await writeFile(manifestPath, JSON.stringify(manifest));

  return { assets, manifestPath };
}
