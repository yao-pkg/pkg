import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
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
  nativeAddons: string[];
}

export interface SeaAssetsResult {
  assets: Record<string, string>;
  manifestPath: string;
}

/**
 * Transform walker/refiner output into SEA-compatible asset map and manifest.
 *
 * Asset keys use refiner paths (no /snapshot prefix) because @platformatic/vfs
 * strips the mount prefix before passing paths to the provider. The entrypoint
 * in the manifest uses the snapshotified path for process.argv[1] compatibility.
 */
export async function generateSeaAssets(
  records: FileRecords,
  entrypoint: string,
  symLinks: SymLinks,
  tmpDir: string,
): Promise<SeaAssetsResult> {
  const assets: Record<string, string> = {};
  const manifest: SeaManifest = {
    entrypoint: snapshotify(entrypoint, path.sep),
    directories: {},
    stats: {},
    symlinks: symLinks,
    nativeAddons: [],
  };

  let modifiedFileCount = 0;

  for (const snap in records) {
    if (!records[snap]) continue;
    const record = records[snap];

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
        assets[snap] = tempPath;
      } else {
        // Unmodified file — point to source on disk
        assets[snap] = record.file;
      }

      // Detect native addons
      if (snap.endsWith('.node')) {
        manifest.nativeAddons.push(snap);
      }
    }

    // Collect directory entries
    if (record[STORE_LINKS]) {
      manifest.directories[snap] = [
        ...new Set(record[STORE_LINKS] as string[]),
      ];
    }

    // Collect stat metadata
    if (record[STORE_STAT]) {
      const stat = record[STORE_STAT];
      manifest.stats[snap] = {
        size: stat.size || 0,
        isFile: Boolean(stat.isFileValue),
        isDirectory: Boolean(stat.isDirectoryValue),
      };
    }
  }

  const manifestPath = join(tmpDir, '__pkg_manifest__.json');
  await writeFile(manifestPath, JSON.stringify(manifest));

  return { assets, manifestPath };
}
