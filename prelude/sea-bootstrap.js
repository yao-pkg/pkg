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

// Custom provider that reads from SEA assets lazily.
// Extends MemoryProvider for directory/stat support while lazily populating
// file content from SEA assets on first access.
class SEAProvider extends MemoryProvider {
  constructor(seaManifest) {
    super();
    this._manifest = seaManifest;
    this._loaded = new Set();

    // Pre-populate directory structure from manifest
    for (var dir of Object.keys(seaManifest.directories)) {
      super.mkdirSync(dir, { recursive: true });
    }
  }

  _resolveSymlink(filePath) {
    var target = this._manifest.symlinks[filePath];
    return target || filePath;
  }

  readFileSync(filePath, options) {
    filePath = this._resolveSymlink(filePath);
    this._ensureLoaded(filePath);
    return super.readFileSync(filePath, options);
  }

  readlinkSync(filePath) {
    var target = this._manifest.symlinks[filePath];
    if (target) return target;
    return super.readlinkSync(filePath);
  }

  _ensureLoaded(filePath) {
    if (this._loaded.has(filePath)) return;
    try {
      var raw = sea.getRawAsset(filePath);
      // getRawAsset returns an ArrayBuffer — Buffer.from copies the data
      super.writeFileSync(filePath, Buffer.from(raw));
      this._loaded.add(filePath);
    } catch (_) {
      // Not a SEA asset — let super handle the ENOENT
    }
  }

  statSync(filePath) {
    filePath = this._resolveSymlink(filePath);
    var meta = this._manifest.stats[filePath];
    if (meta && meta.isFile && !this._loaded.has(filePath)) {
      this._ensureLoaded(filePath);
    }
    return super.statSync(filePath);
  }

  readdirSync(dirPath) {
    var entries = this._manifest.directories[dirPath];
    if (entries) return entries.slice();
    return super.readdirSync(dirPath);
  }

  existsSync(filePath) {
    if (filePath in this._manifest.symlinks) return true;
    filePath = this._resolveSymlink(filePath);
    if (filePath in this._manifest.stats) return true;
    // Fall through to super for directories created via mkdirSync
    try {
      super.statSync(filePath);
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
shared.patchChildProcess(manifest.entrypoint);

// process.pkg setup (shared with traditional bootstrap)
shared.setupProcessPkg(manifest.entrypoint);

// /////////////////////////////////////////////////////////////////
// ENTRYPOINT //////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

process.argv[1] = manifest.entrypoint;
Module._cache = Object.create(null);
try {
  process.mainModule = undefined;
} catch (_) {
  // process.mainModule may become read-only in future Node.js versions
}
Module.runMain();
