/* eslint-disable */
'use strict';

// SEA Bootstrap for pkg
// This script runs before user code in a Node.js Single Executable Application.
// It sets up a Virtual File System from SEA-embedded assets so that
// fs.readFileSync, require, import, etc. work transparently on packaged files.

const sea = require('node:sea');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createHash } = require('crypto');
const Module = require('module');

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

  readFileSync(filePath, options) {
    this._ensureLoaded(filePath);
    return super.readFileSync(filePath, options);
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
// NATIVE ADDON EXTRACTION /////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

var nativeCacheBase =
  process.env.PKG_NATIVE_CACHE_PATH || path.join(os.homedir(), '.cache', 'pkg');

var ancestorDlopen = process.dlopen.bind(process);

process.dlopen = function patchedDlopen(module_, filename, flags) {
  if (typeof filename === 'string' && filename.startsWith(SNAPSHOT_PREFIX)) {
    // Read the .node file content from VFS
    var content = fs.readFileSync(filename);
    var hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    var cacheDir = path.join(nativeCacheBase, hash);

    fs.mkdirSync(cacheDir, { recursive: true });

    var extractedPath = path.join(cacheDir, path.basename(filename));

    try {
      fs.statSync(extractedPath);
    } catch (_) {
      // Not cached yet — extract to real filesystem
      fs.writeFileSync(extractedPath, content, { mode: 0o755 });
    }

    return ancestorDlopen(module_, extractedPath, flags);
  }

  return ancestorDlopen(module_, filename, flags);
};

// /////////////////////////////////////////////////////////////////
// PROCESS COMPATIBILITY ///////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

process.pkg = {
  entrypoint: manifest.entrypoint,
  defaultEntrypoint: manifest.entrypoint,
  path: {
    resolve: function () {
      var args = [path.dirname(manifest.entrypoint)];
      for (var i = 0; i < arguments.length; i++) {
        args.push(arguments[i]);
      }
      return path.resolve.apply(path, args);
    },
  },
  mount: function () {
    throw new Error('process.pkg.mount is not supported in SEA mode');
  },
};

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
