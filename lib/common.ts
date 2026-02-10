import assert from 'assert';
import fs from 'fs';
import path from 'path';

export const STORE_BLOB = 0;
export const STORE_CONTENT = 1;
export const STORE_LINKS = 2;
export const STORE_STAT = 3;
export const ALIAS_AS_RELATIVE = 0; // require("./file.js") // file or directory
export const ALIAS_AS_RESOLVABLE = 1; // require("package")

const win32 = process.platform === 'win32';
const hasURL = typeof URL !== 'undefined';

function uppercaseDriveLetter(f: string) {
  if (f.slice(1, 3) !== ':\\') return f;
  return f[0].toUpperCase() + f.slice(1);
}

function removeTrailingSlashes(f: string) {
  if (f === '/') {
    return f; // dont remove from "/"
  }

  if (f.slice(1) === ':\\') {
    return f; // dont remove from "D:\"
  }

  let last = f.length - 1;

  while (true) {
    const char = f.charAt(last);

    if (char === '\\') {
      f = f.slice(0, -1);
      last -= 1;
    } else if (char === '/') {
      f = f.slice(0, -1);
      last -= 1;
    } else {
      break;
    }
  }
  return f;
}

const isUrl = (p: unknown): p is URL => hasURL && p instanceof URL;

function pathToString(p: string | URL | Buffer, win: boolean): string {
  let result: string;

  if (Buffer.isBuffer(p)) {
    result = p.toString();
  } else if (isUrl(p)) {
    result = win ? p.pathname.replace(/^\//, '') : p.pathname;
  } else {
    result = p;
  }

  return result;
}

export function isRootPath(p: string | URL | Buffer) {
  let file = pathToString(p, false);

  if (file === '.') {
    file = path.resolve(file);
  }

  return path.dirname(file) === p;
}

export function normalizePath(f: string | URL | Buffer) {
  let file = pathToString(f, win32);

  if (!/^.:$/.test(file)) {
    file = path.normalize(file);
  } // 'c:' -> 'c:.'

  if (win32) {
    file = uppercaseDriveLetter(file);
  }

  return removeTrailingSlashes(file);
}

export function isPackageJson(file: string) {
  return path.basename(file) === 'package.json';
}

export function isDotJS(file: string) {
  return ['.js', '.cjs'].includes(path.extname(file));
}

export function isDotJSON(file: string) {
  return path.extname(file) === '.json';
}

export function isDotNODE(file: string) {
  return path.extname(file) === '.node';
}

function replaceSlashes(file: string, slash: string) {
  if (/^.:\\/.test(file)) {
    if (slash === '/') {
      return file.slice(2).replace(/\\/g, '/');
    }
  } else if (/^\//.test(file)) {
    if (slash === '\\') {
      return `C:${file.replace(/\//g, '\\')}`;
    }
  }

  return file;
}

function injectSnapshot(file: string) {
  if (/^.:\\/.test(file)) {
    // C:\path\to
    if (file.length === 3) {
      // C:\
      file = file.slice(0, -1);
    }
    // by convention, on windows we use C:\\snapshot
    return `C:\\snapshot${file.slice(2)}`;
  }

  if (/^\//.test(file)) {
    // /home/user/project
    if (file.length === 1) {
      // /
      file = file.slice(0, -1);
    }

    return `/snapshot${file}`;
  }

  return file;
}

function longestCommonLength(s1: string, s2: string) {
  const length = Math.min(s1.length, s2.length);

  for (let i = 0; i < length; i += 1) {
    if (s1.charCodeAt(i) !== s2.charCodeAt(i)) {
      return i;
    }
  }

  return length;
}

function withoutNodeModules(file: string) {
  return file.split(`${path.sep}node_modules${path.sep}`)[0];
}

export function retrieveDenominator(files: string[]) {
  assert(files.length > 0);

  let s1 = withoutNodeModules(files[0]) + path.sep;

  for (let i = 1; i < files.length; i += 1) {
    const s2 = withoutNodeModules(files[i]) + path.sep;
    s1 = s1.slice(0, longestCommonLength(s1, s2));
  }

  if (s1 === '') {
    return win32 ? 2 : 0;
  }

  return s1.lastIndexOf(path.sep);
}

export function substituteDenominator(f: string, denominator: number) {
  const rootLength = win32 ? 2 : 0;
  return f.slice(0, rootLength) + f.slice(denominator);
}

export function snapshotify(file: string, slash: string) {
  return injectSnapshot(replaceSlashes(file, slash));
}

export function insideSnapshot(f: Buffer | string | URL) {
  f = pathToString(f, win32);

  if (typeof f !== 'string') {
    return false;
  }

  if (win32) {
    const slice112 = f.slice(1, 12);

    return (
      slice112 === ':\\snapshot\\' ||
      slice112 === ':/snapshot\\' ||
      slice112 === ':\\snapshot/' ||
      slice112 === ':/snapshot/' ||
      slice112 === ':\\snapshot' ||
      slice112 === ':/snapshot'
    );
  }

  const slice010 = f.slice(0, 10);

  return slice010 === '/snapshot/' || slice010 === '/snapshot';
}

export function stripSnapshot(f: string) {
  const file = normalizePath(f);

  if (/^.:\\snapshot$/.test(file)) {
    return `${file[0]}:\\**\\`;
  }

  if (/^.:\\snapshot\\/.test(file)) {
    return `${file[0]}:\\**${file.slice(11)}`;
  }

  if (/^\/snapshot$/.test(file)) {
    return '/**/';
  }

  if (/^\/snapshot\//.test(file)) {
    return `/**${file.slice(9)}`;
  }

  return f; // not inside
}

export function removeUplevels(f: string) {
  if (win32) {
    while (true) {
      if (f.slice(0, 3) === '..\\') {
        f = f.slice(3);
      } else if (f === '..') {
        f = '.';
      } else {
        break;
      }
    }

    return f;
  }

  while (true) {
    if (f.slice(0, 3) === '../') {
      f = f.slice(3);
    } else if (f === '..') {
      f = '.';
    } else {
      break;
    }
  }

  return f;
}

export function toNormalizedRealPath(requestPath: string) {
  const file = normalizePath(requestPath);

  if (fs.existsSync(file)) {
    return fs.realpathSync(file);
  }

  return file;
}

/**
 * Find the nearest package.json file by walking up the directory tree
 * @param filePath - Starting file path
 * @returns Path to package.json or null if not found
 */
function findNearestPackageJson(filePath: string): string | null {
  let dir = path.dirname(filePath);
  const { root } = path.parse(dir);

  while (dir !== root) {
    const packageJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
    dir = path.dirname(dir);
  }

  return null;
}

// Caches for ESM detection performance optimization
const packageJsonCache = new Map<string, string | null>();
const esmPackageCache = new Map<string, boolean>();

/**
 * Check if a package.json indicates an ESM package
 * @param packageJsonPath - Path to package.json
 * @returns true if "type": "module" is set
 */
export function isESMPackage(packageJsonPath: string): boolean {
  // Check cache first
  if (esmPackageCache.has(packageJsonPath)) {
    return esmPackageCache.get(packageJsonPath)!;
  }

  try {
    const content = fs.readFileSync(packageJsonPath, 'utf8');
    const pkg = JSON.parse(content);
    const result = pkg.type === 'module';
    esmPackageCache.set(packageJsonPath, result);
    return result;
  } catch {
    esmPackageCache.set(packageJsonPath, false);
    return false;
  }
}

/**
 * Determine if a file should be treated as ESM
 * Based on file extension and nearest package.json "type" field
 *
 * @param filePath - The file path to check
 * @returns true if file should be treated as ESM
 */
export function isESMFile(filePath: string): boolean {
  // .mjs files are always ESM
  if (filePath.endsWith('.mjs')) {
    return true;
  }

  // .cjs files are never ESM
  if (filePath.endsWith('.cjs')) {
    return false;
  }

  // For .js files, check nearest package.json for "type": "module"
  if (filePath.endsWith('.js')) {
    const dir = path.dirname(filePath);

    // Check cache first
    if (packageJsonCache.has(dir)) {
      const cached = packageJsonCache.get(dir);
      if (cached) {
        return isESMPackage(cached);
      }
      return false;
    }

    // Compute and cache
    const packageJsonPath = findNearestPackageJson(filePath);
    packageJsonCache.set(dir, packageJsonPath);

    if (packageJsonPath) {
      return isESMPackage(packageJsonPath);
    }
  }

  return false;
}
