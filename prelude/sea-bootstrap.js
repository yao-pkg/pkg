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

const manifest = JSON.parse(sea.getAsset('__pkg_manifest__', 'utf8'));

// /////////////////////////////////////////////////////////////////
// VFS SETUP ///////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Try native node:vfs first (future Node.js), fall back to polyfill
var vfsModule;
try {
  vfsModule = require('node:vfs');
} catch (_) {
  vfsModule = require('@platformatic/vfs');
}

var VirtualFileSystem = vfsModule.VirtualFileSystem;
var MemoryProvider = vfsModule.MemoryProvider;

// Custom provider that reads from SEA assets lazily (zero-copy via getRawAsset).
// Extends MemoryProvider for directory/stat support while lazily populating
// file content from SEA assets on first access.
class SEAProvider extends MemoryProvider {
  constructor(seaManifest) {
    super();
    this._manifest = seaManifest;
    this._loaded = new Set();

    // Pre-populate directory structure from manifest
    for (var dir of Object.keys(seaManifest.directories)) {
      try {
        super.mkdirSync(dir, { recursive: true });
      } catch (_) {
        // directory may already exist
      }
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
    return filePath in this._manifest.stats;
  }
}

var provider = new SEAProvider(manifest);
var virtualFs = new VirtualFileSystem(provider);
virtualFs.mount('/snapshot', { overlay: true });

// /////////////////////////////////////////////////////////////////
// NATIVE ADDON EXTRACTION /////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

var SNAPSHOT_PREFIX =
  process.platform === 'win32' ? 'C:\\snapshot' : '/snapshot';
var nativeCacheBase =
  process.env.PKG_NATIVE_CACHE_PATH || path.join(os.homedir(), '.cache', 'pkg');

var ancestorDlopen = process.dlopen.bind(process);

process.dlopen = function patchedDlopen(module_, filename, flags) {
  if (typeof filename === 'string' && filename.startsWith(SNAPSHOT_PREFIX)) {
    // Read the .node file content from VFS
    var content = fs.readFileSync(filename);
    var hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    var cacheDir = path.join(nativeCacheBase, hash);

    try {
      fs.mkdirSync(cacheDir, { recursive: true });
    } catch (_) {
      // directory exists
    }

    var extractedPath = path.join(cacheDir, path.basename(filename));

    try {
      fs.statSync(extractedPath);
    } catch (_) {
      // Not cached yet — extract to real filesystem
      fs.writeFileSync(extractedPath, content);
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
};

// /////////////////////////////////////////////////////////////////
// ENTRYPOINT //////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

process.argv[1] = manifest.entrypoint;
Module._cache = Object.create(null);
process.mainModule = undefined;
Module.runMain();
