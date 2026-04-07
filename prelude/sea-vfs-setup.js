'use strict';

// Shared VFS setup for SEA main thread and worker threads.
// Both import this module to avoid duplicating the SEAProvider + mount logic.

var sea = require('node:sea');
var path = require('path');

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

var manifest;
try {
  manifest = JSON.parse(sea.getAsset('__pkg_manifest__', 'utf8'));
} catch (e) {
  throw new Error(
    'pkg: Failed to load VFS manifest from SEA assets: ' + e.message,
  );
}

// Manifest keys are always POSIX (forward slashes, no drive letter).
function toManifestKey(p) {
  return p.replace(/\\/g, '/');
}

// Custom provider that reads from SEA assets lazily.
class SEAProvider extends MemoryProvider {
  constructor(seaManifest) {
    super();
    this._manifest = seaManifest;
    this._loaded = new Set();

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

// On Windows, @platformatic/vfs normalises with path.normalize() which
// uses backslashes, but isUnderMountPoint() uses '/'.  Patch to convert.
if (process.platform === 'win32') {
  var _winToVFS = function (p) {
    if (typeof p !== 'string' || p.startsWith('/')) return p;
    if (/^[A-Za-z]:/.test(p)) p = p.slice(2);
    return p.replace(/\\/g, '/');
  };
  var _origShouldHandle = VirtualFileSystem.prototype.shouldHandle;
  VirtualFileSystem.prototype.shouldHandle = function (inputPath) {
    return _origShouldHandle.call(this, _winToVFS(inputPath));
  };
  var _origResolvePath = VirtualFileSystem.prototype.resolvePath;
  VirtualFileSystem.prototype.resolvePath = function (inputPath) {
    return _origResolvePath.call(this, _winToVFS(inputPath));
  };
}

virtualFs.mount(SNAPSHOT_PREFIX, { overlay: true });

function toPlatformPath(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('/snapshot')) {
    return 'C:' + p.replace(/\//g, '\\');
  }
  return p.replace(/\//g, '\\');
}

function insideSnapshot(f) {
  if (typeof f !== 'string') return false;
  return f.startsWith(SNAPSHOT_PREFIX + path.sep) || f === SNAPSHOT_PREFIX;
}

module.exports = {
  manifest,
  virtualFs,
  provider,
  SNAPSHOT_PREFIX,
  insideSnapshot,
  toPlatformPath,
};
