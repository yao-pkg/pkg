'use strict';

// Shared VFS setup for SEA main thread and worker threads.
// Both import this module to avoid duplicating the SEAProvider + mount logic.

var sea = require('node:sea');

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

// /////////////////////////////////////////////////////////////////
// PERFORMANCE INSTRUMENTATION /////////////////////////////////////
// /////////////////////////////////////////////////////////////////
//
// Enabled by setting DEBUG_PKG_PERF=1 at runtime.  Unlike DEBUG_PKG
// (which requires a --debug build), perf tracing works on any SEA binary.
//
//   DEBUG_PKG_PERF=1 ./my-app
//
// Output example:
//
//   [pkg:perf] phase                 time
//   [pkg:perf] ──────────────────────────────
//   [pkg:perf] manifest parse       14.0ms
//   [pkg:perf] directory tree init  20.5ms
//   [pkg:perf] vfs mount + hooks    3.3ms
//   [pkg:perf] vfs setup total      38.6ms
//   [pkg:perf] module loading     1730.1ms
//   [pkg:perf]
//   [pkg:perf] counter                  value
//   [pkg:perf] ──────────────────────────────
//   [pkg:perf] files loaded               1776
//   [pkg:perf] file cache entries       1776
//   [pkg:perf] sea.getRawAsset()   1047.6ms
//   [pkg:perf] statSync calls              0
//   [pkg:perf] existsSync calls         1540
//   [pkg:perf] readdirSync calls           0

var perf = {
  enabled: !!process.env.DEBUG_PKG_PERF,
  // Phase timers (high-resolution)
  _timers: {},
  // Cumulative counters
  _counters: {},
  // Cumulative durations (BigInt nanoseconds)
  _durations: {},

  /** Mark the start of a named phase. */
  start: function (label) {
    if (!this.enabled) return;
    this._timers[label] = process.hrtime.bigint();
  },

  /** End a named phase and record its duration. */
  end: function (label) {
    if (!this.enabled || !this._timers[label]) return;
    var ns = process.hrtime.bigint() - this._timers[label];
    this._durations[label] = (this._durations[label] || 0n) + ns;
  },

  /** Increment a named counter by n (default 1). */
  count: function (label, n) {
    if (!this.enabled) return;
    this._counters[label] =
      (this._counters[label] || 0) + (n !== undefined ? n : 1);
  },

  /** Add nanoseconds to a cumulative duration counter. */
  addNs: function (label, ns) {
    if (!this.enabled) return;
    this._durations[label] = (this._durations[label] || 0n) + ns;
  },

  /** Format milliseconds from a BigInt nanosecond duration. */
  _ms: function (ns) {
    return (Number(ns) / 1e6).toFixed(1) + 'ms';
  },

  /** Print the final performance report. */
  report: function () {
    if (!this.enabled) return;
    var self = this;
    var P = '[pkg:perf] ';
    var SEP = P + '\u2500'.repeat(30);

    console.log('');
    console.log(P + 'phase                 time');
    console.log(SEP);
    var phaseOrder = [
      'manifest parse',
      'directory tree init',
      'vfs mount + hooks',
      'vfs setup total',
      'module loading',
    ];
    phaseOrder.forEach(function (label) {
      var d = self._durations[label];
      if (d !== undefined) {
        console.log(P + label.padEnd(22) + self._ms(d));
      }
    });

    console.log(P);
    console.log(P + 'counter                  value');
    console.log(SEP);
    var counterOrder = [
      'files loaded',
      'file cache entries',
      'sea.getRawAsset()',
      'statSync calls',
      'existsSync calls',
      'readdirSync calls',
    ];
    counterOrder.forEach(function (label) {
      var v = self._counters[label];
      var d = self._durations[label];
      if (v !== undefined) {
        console.log(P + label.padEnd(22) + String(v).padStart(8));
      } else if (d !== undefined) {
        console.log(P + label.padEnd(22) + self._ms(d).padStart(8));
      } else {
        // Show zero for expected counters that were never incremented
        console.log(P + label.padEnd(22) + String(0).padStart(8));
      }
    });
    console.log('');
  },
};

// /////////////////////////////////////////////////////////////////
// MANIFEST ////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

perf.start('manifest parse');
var manifest;
try {
  manifest = JSON.parse(sea.getAsset('__pkg_manifest__', 'utf8'));
} catch (e) {
  throw new Error(
    'pkg: Failed to load VFS manifest from SEA assets: ' + e.message,
  );
}
perf.end('manifest parse');

// Manifest keys are always POSIX (forward slashes, no drive letter).
function toManifestKey(p) {
  return p.replace(/\\/g, '/');
}

function _enoent(syscall, filePath) {
  var err = new Error(
    'ENOENT: no such file or directory, ' + syscall + " '" + filePath + "'",
  );
  err.code = 'ENOENT';
  err.errno = -2;
  err.syscall = syscall;
  err.path = filePath;
  return err;
}

// /////////////////////////////////////////////////////////////////
// SEA PROVIDER ////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Lightweight stat factory — creates objects compatible with Node.js fs.Stats.
// The module resolution hot path uses internalModuleStat() instead, which
// returns only 0/1/-2 from the manifest without allocating stat objects.
var _now = Date.now();
function _makeStats(meta) {
  return {
    dev: 0,
    ino: 0,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 4096,
    mode: meta.isDirectory ? 0o40755 : 0o100644,
    size: meta.size || 0,
    blocks: Math.ceil((meta.size || 0) / 512),
    atimeMs: _now,
    mtimeMs: _now,
    ctimeMs: _now,
    birthtimeMs: _now,
    atime: new Date(_now),
    mtime: new Date(_now),
    ctime: new Date(_now),
    birthtime: new Date(_now),
    isFile: function () {
      return meta.isFile;
    },
    isDirectory: function () {
      return meta.isDirectory;
    },
    isSymbolicLink: function () {
      return false;
    },
    isBlockDevice: function () {
      return false;
    },
    isCharacterDevice: function () {
      return false;
    },
    isFIFO: function () {
      return false;
    },
    isSocket: function () {
      return false;
    },
  };
}

/**
 * SEA asset provider — reads files lazily from the SEA binary.
 *
 * Performance design:
 *
 *   - internalModuleStat()  O(1) manifest hash lookup (no tree walk).
 *     This is the hottest path (~30K calls for large projects).
 *
 *   - statSync()            O(1) manifest lookup + lightweight stat allocation.
 *     Not on the module resolution hot path.  Returns a fresh object each call.
 *
 *   - existsSync()          O(1) manifest lookup.
 *
 *   - readFileSync()        sea.getRawAsset() with a Map cache.  Bypasses the
 *     MemoryProvider tree entirely.  Returns a Buffer copy to prevent cache
 *     corruption from callers mutating the buffer.
 *
 *   - readdirSync()         Returns manifest directory entries directly.
 *
 * The MemoryProvider base class directory tree is still populated at
 * construction time as a safety net for edge-case super method fallbacks
 * (e.g., readlinkSync).
 */
class SEAProvider extends MemoryProvider {
  constructor(seaManifest) {
    super();
    this._manifest = seaManifest;
    this._fileCache = new Map();

    // Populate MemoryProvider directory tree as a safety net for edge-case
    // fallbacks to super methods (e.g., readlinkSync for non-manifest paths).
    perf.start('directory tree init');
    for (var dir of Object.keys(seaManifest.directories)) {
      super.mkdirSync(dir, { recursive: true });
    }
    perf.end('directory tree init');
  }

  _resolveSymlink(p) {
    for (var i = 0; i < 40; i++) {
      var target = this._manifest.symlinks[p];
      if (!target) return p;
      p = target;
    }
    return p;
  }

  readFileSync(filePath, options) {
    var p = this._resolveSymlink(toManifestKey(filePath));
    // Fast path: read from SEA asset with a Map cache, bypassing the
    // MemoryProvider tree walk for both write and read.
    var buf = this._fileCache.get(p);
    if (buf === undefined) {
      var raw;
      try {
        if (perf.enabled) var t0 = process.hrtime.bigint();
        raw = sea.getRawAsset(p);
        if (perf.enabled)
          perf.addNs('sea.getRawAsset()', process.hrtime.bigint() - t0);
      } catch (_) {
        throw _enoent('open', filePath);
      }
      buf = Buffer.from(raw);
      this._fileCache.set(p, buf);
      perf.count('files loaded');
    }
    var encoding =
      typeof options === 'string' ? options : options && options.encoding;
    // Strings are immutable — safe to return directly from cache.
    // Buffers must be copied to prevent callers from corrupting the cache.
    if (encoding) return buf.toString(encoding);
    var copy = Buffer.allocUnsafe(buf.length);
    buf.copy(copy);
    return copy;
  }

  readlinkSync(filePath) {
    var p = toManifestKey(filePath);
    var target = this._manifest.symlinks[p];
    if (target) return target;
    return super.readlinkSync(p);
  }

  statSync(filePath) {
    perf.count('statSync calls');
    var p = this._resolveSymlink(toManifestKey(filePath));
    var meta = this._manifest.stats[p];
    if (meta) {
      // Return a fresh stat object — matches Node.js fs.statSync contract.
      return _makeStats(meta);
    }
    throw _enoent('stat', filePath);
  }

  /**
   * Fast module resolution stat — returns 0 (file), 1 (directory), or -2
   * (not found) directly from the manifest.  This is the hottest path during
   * startup (~30K calls for large projects) so it must be as lean as possible.
   */
  internalModuleStat(filePath) {
    var p = this._resolveSymlink(toManifestKey(filePath));
    var meta = this._manifest.stats[p];
    if (meta) {
      return meta.isDirectory ? 1 : 0;
    }
    return -2;
  }

  readdirSync(dirPath) {
    perf.count('readdirSync calls');
    var p = this._resolveSymlink(toManifestKey(dirPath));
    var entries = this._manifest.directories[p];
    if (entries) return entries.slice();
    return super.readdirSync(p);
  }

  existsSync(filePath) {
    perf.count('existsSync calls');
    var p = this._resolveSymlink(toManifestKey(filePath));
    return p in this._manifest.stats;
  }
}

// /////////////////////////////////////////////////////////////////
// VFS MOUNT ///////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

perf.start('vfs mount + hooks');
var provider = new SEAProvider(manifest);
var virtualFs = new VirtualFileSystem(provider);

// Always mount with a POSIX prefix — @platformatic/vfs internally relies on
// '/' as path separator (isUnderMountPoint, getRelativePath, etc.).
// Our prototype patches below convert Windows paths to POSIX before they
// reach the VFS, and Node's VFS module hooks use the V: sentinel drive
// for subsequent path resolution, which normalizeVFSPath already handles.
var SNAPSHOT_PREFIX = '/snapshot';

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
perf.end('vfs mount + hooks');

// /////////////////////////////////////////////////////////////////
// HELPERS /////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

function toPlatformPath(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('/snapshot')) {
    return 'C:' + p.replace(/\//g, '\\');
  }
  return p.replace(/\//g, '\\');
}

function insideSnapshot(f) {
  if (typeof f !== 'string') return false;
  if (f.startsWith('/snapshot/') || f === '/snapshot') return true;
  if (process.platform === 'win32') {
    // Module hooks use the V: sentinel drive; dlopen/child_process use C:
    if (
      f.startsWith('V:\\snapshot\\') ||
      f.startsWith('V:/snapshot/') ||
      f === 'V:\\snapshot' ||
      f === 'V:/snapshot' ||
      f.startsWith('C:\\snapshot\\') ||
      f.startsWith('C:/snapshot/') ||
      f === 'C:\\snapshot' ||
      f === 'C:/snapshot'
    )
      return true;
  }
  return false;
}

module.exports = {
  manifest,
  virtualFs,
  provider,
  perf,
  SNAPSHOT_PREFIX,
  insideSnapshot,
  toPlatformPath,
};
