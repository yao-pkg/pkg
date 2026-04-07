'use strict';

// SEA Bootstrap for pkg
// This script runs before user code in a Node.js Single Executable Application.
// It sets up a Virtual File System from SEA-embedded assets so that
// fs.readFileSync, require, import, etc. work transparently on packaged files.

var sea = require('node:sea');
var path = require('path');
var Module = require('module');
var shared = require('./bootstrap-shared');

// /////////////////////////////////////////////////////////////////
// MANIFEST ////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

var manifest;
try {
  manifest = JSON.parse(sea.getAsset('__pkg_manifest__', 'utf8'));
} catch (e) {
  throw new Error(
    'pkg: Failed to load VFS manifest from SEA assets: ' + e.message,
  );
}

// /////////////////////////////////////////////////////////////////
// VFS SETUP ///////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Try native node:vfs first (future Node.js), fall back to polyfill
var vfsModule;
try {
  vfsModule = require('node:vfs');
} catch (_) {
  try {
    vfsModule = require('@platformatic/vfs');
  } catch (e) {
    throw new Error(
      'pkg: VFS polyfill (@platformatic/vfs) is not available: ' + e.message,
    );
  }
}

var VirtualFileSystem = vfsModule.VirtualFileSystem;
var MemoryProvider = vfsModule.MemoryProvider;

// Manifest keys are always POSIX (forward slashes, no drive letter).
// VFS may pass platform-native paths after stripping the mount prefix,
// so normalise before any manifest or SEA-asset lookup.
function toManifestKey(p) {
  return p.replace(/\\/g, '/');
}

// Custom provider that reads from SEA assets lazily.
// Extends MemoryProvider for directory/stat support while lazily populating
// file content from SEA assets on first access.
//
// All paths are normalised to POSIX (via toManifestKey) before use, so
// manifest lookups, SEA asset lookups, and MemoryProvider storage all use
// the same key format regardless of platform.
class SEAProvider extends MemoryProvider {
  constructor(seaManifest) {
    super();
    this._manifest = seaManifest;
    this._loaded = new Set();

    // Pre-populate directory structure from manifest (keys are already POSIX)
    for (var dir of Object.keys(seaManifest.directories)) {
      super.mkdirSync(dir, { recursive: true });
    }
  }

  _resolveSymlink(p) {
    var target = this._manifest.symlinks[p];
    return target || p;
  }

  readFileSync(filePath, options) {
    var p = this._resolveSymlink(toManifestKey(filePath));
    this._ensureLoaded(p);
    return super.readFileSync(p, options);
  }

  readlinkSync(filePath) {
    var p = toManifestKey(filePath);
    var target = this._manifest.symlinks[p];
    if (target) return target;
    return super.readlinkSync(p);
  }

  _ensureLoaded(p) {
    if (this._loaded.has(p)) return;
    try {
      var raw = sea.getRawAsset(p);
      // getRawAsset returns an ArrayBuffer — Buffer.from copies the data
      super.writeFileSync(p, Buffer.from(raw));
      this._loaded.add(p);
    } catch (_) {
      // Not a SEA asset — let super handle the ENOENT
    }
  }

  statSync(filePath) {
    var p = this._resolveSymlink(toManifestKey(filePath));
    var meta = this._manifest.stats[p];
    if (meta && meta.isFile && !this._loaded.has(p)) {
      this._ensureLoaded(p);
    }
    return super.statSync(p);
  }

  readdirSync(dirPath) {
    var p = toManifestKey(dirPath);
    var entries = this._manifest.directories[p];
    if (entries) return entries.slice();
    return super.readdirSync(p);
  }

  existsSync(filePath) {
    var p = toManifestKey(filePath);
    if (p in this._manifest.symlinks) return true;
    p = this._resolveSymlink(p);
    if (p in this._manifest.stats) return true;
    // Fall through to super for directories created via mkdirSync
    try {
      super.statSync(p);
      return true;
    } catch (_) {
      return false;
    }
  }
}

var provider = new SEAProvider(manifest);
var virtualFs = new VirtualFileSystem(provider);

var SNAPSHOT_PREFIX =
  process.platform === 'win32' ? 'C:\\snapshot' : '/snapshot';

// Mount at the appropriate prefix for the runtime platform
virtualFs.mount(SNAPSHOT_PREFIX, { overlay: true });

// /////////////////////////////////////////////////////////////////
// PATH NORMALIZATION //////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// The manifest always stores paths with POSIX '/' separators so that
// the same blob works regardless of build platform.  On Windows we
// must convert them to the native format before handing them to
// Node's module resolver or VFS lookups.
function toPlatformPath(p) {
  if (process.platform !== 'win32') return p;
  // /snapshot/… → C:\snapshot\…
  if (p.startsWith('/snapshot')) {
    return 'C:' + p.replace(/\//g, '\\');
  }
  return p.replace(/\//g, '\\');
}

var entrypoint = toPlatformPath(manifest.entrypoint);

// /////////////////////////////////////////////////////////////////
// SHARED PATCHES //////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Detect whether a path is inside the snapshot
function insideSnapshot(f) {
  if (typeof f !== 'string') return false;
  return f.startsWith(SNAPSHOT_PREFIX + path.sep) || f === SNAPSHOT_PREFIX;
}

// Native addon extraction (shared with traditional bootstrap)
shared.patchDlopen(insideSnapshot);

// child_process patching (shared with traditional bootstrap)
shared.patchChildProcess(entrypoint);

// process.pkg setup (shared with traditional bootstrap)
shared.setupProcessPkg(entrypoint);

// /////////////////////////////////////////////////////////////////
// DIAGNOSTICS /////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Only available when the binary was built with --debug / -d.
// At runtime, set DEBUG_PKG=1 (VFS tree) or DEBUG_PKG=2 (+ fs tracing).
if (manifest.debug) {
  shared.installDiagnostic(SNAPSHOT_PREFIX);
}

// /////////////////////////////////////////////////////////////////
// ENTRYPOINT //////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

process.argv[1] = entrypoint;
Module._cache = Object.create(null);
try {
  process.mainModule = undefined;
} catch (_) {
  // process.mainModule may become read-only in future Node.js versions
}
Module.runMain();
