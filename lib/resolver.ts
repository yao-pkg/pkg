import { sync as resolveSync } from 'resolve';
import { exports as resolveExports } from 'resolve.exports';
import fs from 'fs';
import path from 'path';
import { isESMFile } from './common';
import { log } from './log';

import type { PackageJson } from './types';

/**
 * Enhanced module resolver that supports both CommonJS and ESM resolution
 * Handles package.json "exports" field and ESM-specific resolution rules
 */

interface ResolveOptions {
  basedir: string;
  extensions?: string[];
  conditions?: string[];
}

interface ResolveResult {
  resolved: string;
  isESM: boolean;
}

/**
 * Resolve using package.json "exports" field (ESM-style)
 * @param packageName - Package name (e.g., 'nanoid')
 * @param subpath - Subpath within package (e.g., './url-alphabet')
 * @param packageRoot - Absolute path to package root
 * @returns Resolved path or null if not found
 */
function resolveWithExports(
  packageName: string,
  subpath: string,
  packageRoot: string,
): string | null {
  try {
    const packageJsonPath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    const pkg: PackageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8'),
    );

    // Check if package has exports field
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkgAny = pkg as any;
    if (!pkgAny.exports) {
      return null;
    }

    // Use resolve.exports to handle the exports field
    // For pkg's context, we're bundling CJS code, so try 'require' condition first
    // Then fallback to 'import' for ESM-only packages
    let resolved = resolveExports(pkgAny, subpath, {
      require: true, // Try require first
    });

    // Fallback to import condition for ESM-only packages
    if (!resolved) {
      resolved = resolveExports(pkgAny, subpath, {
        require: false, // This enables import condition
      });
    }

    if (resolved) {
      // resolved can be a string or array
      const resolvedPath = Array.isArray(resolved) ? resolved[0] : resolved;
      const fullPath = path.join(packageRoot, resolvedPath);

      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  } catch (error) {
    log.debug(`Failed to resolve with exports field: ${packageName}${subpath}`);
    return null;
  }
}

/**
 * Try to resolve a module specifier as an ESM package
 * @param specifier - Module specifier (e.g., 'nanoid', 'nanoid/url-alphabet')
 * @param basedir - Base directory for resolution
 * @returns Resolved path or null
 */
function tryResolveESM(specifier: string, basedir: string): string | null {
  try {
    // Parse package name and subpath
    let packageName: string;
    let subpath: string;

    if (specifier.startsWith('@')) {
      // Scoped package: @org/pkg or @org/pkg/subpath
      const parts = specifier.split('/');
      packageName = `${parts[0]}/${parts[1]}`;
      subpath = parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.';
    } else {
      // Regular package: pkg or pkg/subpath
      const slashIndex = specifier.indexOf('/');
      if (slashIndex === -1) {
        packageName = specifier;
        subpath = '.';
      } else {
        packageName = specifier.substring(0, slashIndex);
        subpath = `./${specifier.substring(slashIndex + 1)}`;
      }
    }

    // Use resolveSync to find the package root (works with pnpm and other layouts)
    // Try to resolve the package.json to get the package root
    try {
      const pkgJsonPath = resolveSync(
        path.join(packageName, 'package.json'),
        {
          basedir,
          preserveSymlinks: false,
        },
      );

      const packageRoot = path.dirname(pkgJsonPath);

      // Try to resolve with exports field
      const resolved = resolveWithExports(packageName, subpath, packageRoot);
      if (resolved) {
        return resolved;
      }
    } catch {
      // If package.json resolution fails, fall through to return null
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a module specifier with ESM support
 * Falls back to standard CommonJS resolution if ESM resolution fails
 *
 * @param specifier - Module specifier to resolve
 * @param options - Resolution options
 * @returns Resolved file path and ESM flag
 */
export function resolveModule(
  specifier: string,
  options: ResolveOptions,
): ResolveResult {
  const { basedir, extensions = ['.js', '.json', '.node'] } = options;

  // First, try ESM-style resolution with exports field
  const esmResolved = tryResolveESM(specifier, basedir);
  if (esmResolved) {
    // Use isESMFile which walks up to find the correct package.json
    return {
      resolved: esmResolved,
      isESM: isESMFile(esmResolved),
    };
  }

  // Fallback to standard CommonJS resolution
  const resolved = resolveSync(specifier, {
    basedir,
    extensions,
  });

  return {
    resolved,
    isESM: false, // CJS resolution
  };
}
