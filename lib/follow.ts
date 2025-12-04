import { sync, SyncOpts } from 'resolve';
import fs from 'fs';
import path from 'path';
import { toNormalizedRealPath } from './common';
import { resolveModule } from './resolver';
import { log } from './log';

import type { PackageJson } from './types';

const PROOF = 'a-proof-that-main-is-captured.js';

function parentDirectoriesContain(parent: string, directory: string) {
  let currentParent = parent;

  while (true) {
    if (currentParent === directory) {
      return true;
    }

    const newParent = path.dirname(currentParent);

    if (newParent === currentParent) {
      return false;
    }

    currentParent = newParent;
  }
}

interface FollowOptions extends Pick<SyncOpts, 'basedir' | 'extensions'> {
  ignoreFile?: string;
  catchReadFile?: (file: string) => void;
  catchPackageFilter?: (config: PackageJson, base: string, dir: string) => void;
}

export function follow(x: string, opts: FollowOptions) {
  // TODO async version
  return new Promise<string>((resolve, reject) => {
    // Try ESM-aware resolution first for non-relative specifiers
    if (!x.startsWith('.') && !x.startsWith('/') && !path.isAbsolute(x)) {
      try {
        const result = resolveModule(x, {
          basedir: opts.basedir || process.cwd(),
          extensions: Array.isArray(opts.extensions) ? opts.extensions : opts.extensions ? [opts.extensions] : ['.js', '.json', '.node'],
        });
        
        log.debug(`ESM resolver found: ${x} -> ${result.resolved}`);
        
        // If there's a catchReadFile callback, we need to notify about package.json
        // so it gets included in the bundle (required for runtime resolution)
        if (opts.catchReadFile) {
          // Find the package.json for this resolved module
          let currentDir = path.dirname(result.resolved);
          let packageDir = '';
          while (currentDir !== path.dirname(currentDir)) {
            const pkgPath = path.join(currentDir, 'package.json');
            if (fs.existsSync(pkgPath)) {
              // Check if this package.json is in node_modules (not the root package)
              if (currentDir.includes('node_modules')) {
                opts.catchReadFile(pkgPath);
                packageDir = currentDir;
                
                // Also call catchPackageFilter if provided
                if (opts.catchPackageFilter) {
                  let pkgContent = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                  
                  // If package doesn't have a "main" field but we resolved via exports,
                  // add a synthetic "main" field so runtime resolution works
                  if (!pkgContent.main && result.isESM) {
                    const relativePath = path.relative(currentDir, result.resolved);
                    pkgContent.main = `./${relativePath.replace(/\\/g, '/')}`;
                  }
                  
                  opts.catchPackageFilter(pkgContent, currentDir, currentDir);
                }
                break;
              }
            }
            currentDir = path.dirname(currentDir);
          }
        }
        
        resolve(result.resolved);
        return;
      } catch (error) {
        // Fall through to standard resolution
        log.debug(
          `ESM resolver failed for ${x}, trying standard resolution: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Use standard CommonJS resolution
    try {
      resolve(
        sync(x, {
          basedir: opts.basedir,
          extensions: opts.extensions,
        isFile: (file) => {
          if (
            opts.ignoreFile &&
            path.join(path.dirname(opts.ignoreFile), PROOF) === file
          ) {
            return true;
          }

          let stat;

          try {
            stat = fs.statSync(file);
          } catch (e) {
            const ex = e as NodeJS.ErrnoException;

            if (ex && (ex.code === 'ENOENT' || ex.code === 'ENOTDIR'))
              return false;

            throw ex;
          }

          return stat.isFile() || stat.isFIFO();
        },
        isDirectory: (directory) => {
          if (
            opts.ignoreFile &&
            parentDirectoriesContain(opts.ignoreFile, directory)
          ) {
            return false;
          }

          let stat;

          try {
            stat = fs.statSync(directory);
          } catch (e) {
            const ex = e as NodeJS.ErrnoException;

            if (ex && (ex.code === 'ENOENT' || ex.code === 'ENOTDIR')) {
              return false;
            }

            throw ex;
          }

          return stat.isDirectory();
        },
        readFileSync: (file) => {
          if (opts.ignoreFile && opts.ignoreFile === file) {
            return Buffer.from(`{"main":"${PROOF}"}`);
          }

          if (opts.catchReadFile) {
            opts.catchReadFile(file);
          }

          return fs.readFileSync(file);
        },
        packageFilter: (config, base, dir) => {
          if (opts.catchPackageFilter) {
            opts.catchPackageFilter(config, base, dir);
          }

          return config;
        },

        /** function to synchronously resolve a potential symlink to its real path */
        // realpathSync?: (file: string) => string;
          realpathSync: (file) => {
          const file2 = toNormalizedRealPath(file);
          return file2;
        },
        }),
      );
    } catch (error) {
      reject(error);
    }
  });
}