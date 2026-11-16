import { sync as resolveSync } from 'resolve';
import {
  exports as resolveExports,
  imports as resolveImports,
} from 'resolve.exports';
import fs from 'fs';
import { isBuiltin } from 'module';
import path from 'path';
import { findNearestPackageJsonFromDir, isESMFile } from './common';
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

type ResolvedTargets = string | string[] | undefined;

/**
 * Resolve "exports" or "imports" targets with the condition order pkg uses
 * for both: pkg bundles CJS code, so the `require` condition is tried first,
 * then `import` for ESM-only targets.
 * @param resolveTargets - Runs resolve.exports with the given options
 * @returns The first non-empty result
 */
function resolveInConditionOrder(
  resolveTargets: (options: { require: boolean }) => ResolvedTargets,
): ResolvedTargets {
  for (const preferRequire of [true, false]) {
    const resolved = resolveTargets({ require: preferRequire });
    if (resolved) return resolved;
  }
  return undefined;
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
    const resolved = resolveInConditionOrder((options) =>
      resolveExports(pkgAny, subpath, options),
    );

    if (resolved) {
      // resolved can be a string or array
      const resolvedPath = Array.isArray(resolved) ? resolved[0] : resolved;
      const fullPath = path.join(packageRoot, resolvedPath);

      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  } catch (_error) {
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
      const pkgJsonPath = resolveSync(path.join(packageName, 'package.json'), {
        basedir,
        preserveSymlinks: false,
      });

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

export interface PackageImportResult {
  /** Absolute path of the resolved file, or the bare/builtin target specifier */
  target: string;
  /**
   * `file`: a file of the declaring package, `bare`: another package
   * (e.g. "#dep": "some-pkg"), `builtin`: a Node.js builtin ("#fs": "node:fs")
   */
  kind: 'file' | 'bare' | 'builtin';
  /** package.json that declares the "imports" field */
  packageJson: string;
  /** Parsed content of `packageJson` */
  config: PackageJson;
}

/**
 * Resolve a package.json "imports" specifier (subpath import, e.g.
 * `#ansi-styles`). Like Node.js, only the nearest package.json of
 * `basedir` (the package scope) is consulted.
 *
 * The packaged binary resolves the specifier again at runtime with
 * `resolveImportsTargets` in prelude/bootstrap-shared.js (the prelude can't
 * load `resolve.exports`). Both must follow the same rules, otherwise the
 * binary looks for files that were never bundled.
 * test/unit/package-imports.test.ts compares the two.
 * @param specifier - Specifier starting with '#'
 * @param basedir - Directory of the importing file
 * @returns Resolution result
 * @throws If the specifier can't be resolved; the message names the reason
 */
export function resolvePackageImport(
  specifier: string,
  basedir: string,
): PackageImportResult {
  const notFound = (reason: string) =>
    new Error(`Cannot find module '${specifier}' from '${basedir}': ${reason}`);

  const packageJson = findNearestPackageJsonFromDir(path.resolve(basedir));
  if (!packageJson) throw notFound('no package.json found');

  let config: PackageJson;
  try {
    config = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
  } catch (error) {
    throw notFound(`cannot read ${packageJson}: ${(error as Error).message}`);
  }

  const resolved = resolveInConditionOrder((options) => {
    try {
      return resolveImports(
        config as Record<string, unknown>,
        specifier,
        options,
      );
    } catch {
      // resolve.exports throws for an unknown key and for unmatched conditions
      return undefined;
    }
  });
  if (!resolved) {
    throw notFound(`not defined in "imports" of ${packageJson}`);
  }

  const targets = Array.isArray(resolved) ? resolved : [resolved];
  for (const target of targets) {
    if (target.startsWith('./') || target.startsWith('../')) {
      const file = path.join(path.dirname(packageJson), target);
      if (fs.existsSync(file)) {
        return { target: file, kind: 'file', packageJson, config };
      }
    } else if (!target.startsWith('#') && !path.isAbsolute(target)) {
      // Another `#` specifier is not a valid target (and could loop forever)
      const kind = isBuiltin(target) ? 'builtin' : 'bare';
      return { target, kind, packageJson, config };
    }
  }
  throw notFound(
    `no usable target in "imports" of ${packageJson} (${targets.join(', ')})`,
  );
}
