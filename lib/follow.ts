import { sync, SyncOpts } from 'resolve';
import fs from 'fs';
import path from 'path';
import { toNormalizedRealPath } from './common';
import { resolveModule } from './resolver';

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

/**
 * Check if a specifier looks like a valid npm package name
 * npm package names must be lowercase and can only contain:
 * - lowercase letters, digits, hyphens, underscores, dots
 * - can be scoped (@scope/package)
 * This helps filter out generated aliases like "connectNonLiteral"
 */
function isValidPackageName(specifier: string): boolean {
  // Scoped packages: @scope/package
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length < 2) return false;
    // Scope must start with @ and both parts must be valid
    return /^@[a-z0-9_.-]+$/.test(parts[0]) && /^[a-z0-9_.-]+$/.test(parts[1]);
  }

  // Regular package: must be lowercase with allowed characters
  // Package name is the part before the first '/' (if any)
  const packageName = specifier.split('/')[0];
  return /^[a-z0-9_.-]+$/.test(packageName);
}

export function follow(x: string, opts: FollowOptions) {
  // TODO async version
  return new Promise<string>((resolve, reject) => {
    // Try ESM-aware resolution first for non-relative specifiers
    // Skip if the specifier doesn't look like a valid npm package name
    // (e.g., generated aliases like "connectNonLiteral")
    if (
      !x.startsWith('.') &&
      !x.startsWith('/') &&
      !path.isAbsolute(x) &&
      isValidPackageName(x)
    ) {
      try {
        let extensions: string[];
        if (Array.isArray(opts.extensions)) {
          extensions = opts.extensions as string[];
        } else if (opts.extensions) {
          extensions = [opts.extensions as string];
        } else {
          extensions = ['.js', '.json', '.node'];
        }

        const result = resolveModule(x, {
          basedir: opts.basedir || process.cwd(),
          extensions,
        });

        // Only use ESM resolution result if it's an actual ESM package
        // For CJS packages, fall through to standard CommonJS resolution
        // to ensure all callbacks (catchReadFile, catchPackageFilter) are handled correctly
        if (result.isESM) {
          // This is a real ESM package, handle it here
          if (opts.catchReadFile) {
            // Find the package.json for this resolved module
            let currentDir = path.dirname(result.resolved);
            while (currentDir !== path.dirname(currentDir)) {
              const pkgPath = path.join(currentDir, 'package.json');

              // Honor ignoreFile to ensure correct package marker determination
              if (
                opts.ignoreFile &&
                path.normalize(pkgPath) === path.normalize(opts.ignoreFile)
              ) {
                // Skip this package.json as it's marked to be ignored
                currentDir = path.dirname(currentDir);
                continue;
              }

              if (fs.existsSync(pkgPath)) {
                // Check if this package.json is in node_modules (not the root package)
                if (currentDir.includes('node_modules')) {
                  opts.catchReadFile(pkgPath);

                  // Also call catchPackageFilter if provided
                  if (opts.catchPackageFilter) {
                    const pkgContent = JSON.parse(
                      fs.readFileSync(pkgPath, 'utf8'),
                    );

                    // If package doesn't have a "main" field but we resolved via exports,
                    // add a synthetic "main" field so runtime resolution works
                    if (!pkgContent.main) {
                      const relativePath = path.relative(
                        currentDir,
                        result.resolved,
                      );
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

          // ESM package resolved successfully
          resolve(result.resolved);
          return;
        }

        // CJS package - fall through to standard CommonJS resolution
        // to handle all callbacks properly
      } catch (_error) {
        // ESM resolution failed - fall through to standard CommonJS resolution
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
