'use strict';

// Shared VFS setup for SEA main thread and worker threads.
// Both import this module to avoid duplicating the SEAProvider + mount logic.

var sea = require('node:sea');
var shared = require('./bootstrap-shared');

var COMPRESS_NONE = shared.COMPRESS_NONE;

var vfsModule;
try {
  vfsModule = require('node:vfs');
} catch (_) {
  try {
    vfsModule = require('@roberts_lando/vfs');
  } catch (e) {
    throw new Error(
      'pkg: VFS polyfill (@roberts_lando/vfs) is not available: ' + e.message,
    );
  }
}

var VirtualFileSystem = vfsModule.VirtualFileSystem;
var MemoryProvider = vfsModule.MemoryProvider;

// Matches the typical Linux SYMLOOP_MAX. Bounds the symlink resolution
// loop so a manifest cycle (or a corrupt manifest) cannot hang startup.
var MAX_SYMLINK_DEPTH = 40;

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
//   [pkg:perf] archive load          1.2ms
//   [pkg:perf] directory tree init  20.5ms
//   [pkg:perf] vfs mount + hooks    3.3ms
//   [pkg:perf] vfs setup total      39.8ms
//   [pkg:perf] module loading      730.1ms
//   [pkg:perf]
//   [pkg:perf] counter                  value
//   [pkg:perf] ──────────────────────────────
//   [pkg:perf] files loaded               1776
//   [pkg:perf] file cache entries       1776
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

  /**
   * Finalize perf tracking: end the `module loading` phase, aggregate
   * the `vfs setup total`, capture the file-cache-entries counter from
   * the provider, and print the report.  Called by each bootstrap
   * dispatcher at the appropriate point so the module-loading phase
   * timing reflects actual entrypoint completion.
   */
  finalize: function () {
    if (!this.enabled) return;
    this.end('module loading');
    this._durations['vfs setup total'] =
      (this._durations['manifest parse'] || 0n) +
      (this._durations['archive load'] || 0n) +
      (this._durations['directory tree init'] || 0n) +
      (this._durations['vfs mount + hooks'] || 0n);
    if (this._provider) {
      this._counters['file cache entries'] = this._provider.fileCacheSize;
    }
    this.report();
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
      'archive load',
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

// Manifest keys are always POSIX (forward slashes, no drive letter) and
// carry no trailing separator.  Gate the backslash regex on platform: on
// POSIX hosts paths already match, so the replace is a pure allocation and
// we skip it (~30K calls per startup on large projects).  On Windows,
// backslash normalization is mandatory.
//
// Trailing separators are stripped on both platforms so lookups with paths
// like `/snapshot/.../dist/` — common when a path is joined with a blank
// segment or produced by libraries that append `/` to directory paths —
// match the non-slashed manifest keys.  The root '/' is preserved as-is.
// Mirrors removeTrailingSlashes() in lib/common.ts, which handles the same
// case for the classic (non-SEA) bootstrap.
function _stripTrailingSeps(p) {
  var i = p.length;
  while (i > 1) {
    var c = p.charCodeAt(i - 1);
    if (c !== 47 /* / */ && c !== 92 /* \\ */) break;
    i--;
  }
  return i === p.length ? p : p.slice(0, i);
}
var toManifestKey =
  process.platform === 'win32'
    ? function (p) {
        return _stripTrailingSeps(p.replace(/\\/g, '/'));
      }
    : function (p) {
        return _stripTrailingSeps(p);
      };

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
 * SEA asset provider — reads files from a single archive blob embedded in the
 * SEA binary.  All file contents are packed into one asset ('__pkg_archive__')
 * at build time; the manifest's `offsets` map provides [byteOffset, byteLength]
 * for each file so readFileSync can extract them via zero-copy Buffer.subarray().
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
 *   - readFileSync()        Zero-copy subarray from the archive with a Map
 *     cache.  Bypasses the MemoryProvider tree entirely.  Returns a Buffer
 *     copy to prevent callers from corrupting the archive.
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

    // Pick the per-file decompressor once at construction time.  Absent or 0 =
    // uncompressed archive (backward compat with pre-#250 SEA binaries).  The
    // shared helper raises a uniformly-worded error when the host Node.js is
    // missing the Zstd API.
    this._compression = seaManifest.compression || COMPRESS_NONE;
    this._decompress = shared.pickDecompressorSync(this._compression);

    // Load the single archive blob — zero-copy view of the SEA asset's
    // ArrayBuffer.  All file contents are packed here; individual files
    // are extracted via subarray() using manifest.offsets.
    perf.start('archive load');
    try {
      this._archive = Buffer.from(sea.getRawAsset('__pkg_archive__'));
    } catch (e) {
      throw new Error(
        'pkg: Failed to load archive from SEA assets: ' + e.message,
      );
    }
    perf.end('archive load');

    // Populate MemoryProvider directory tree as a safety net for edge-case
    // fallbacks to super methods (e.g., readlinkSync for non-manifest paths).
    perf.start('directory tree init');
    for (var dir of Object.keys(seaManifest.directories)) {
      super.mkdirSync(dir, { recursive: true });
    }
    perf.end('directory tree init');
  }

  _resolveSymlink(p) {
    // Fast path: the vast majority of lookups (~30K per startup on large
    // projects) are not symlinks. A single object-has-key check avoids
    // entering the loop and the i++/target fetch overhead for the common
    // case.
    var symlinks = this._manifest.symlinks;
    if (symlinks[p] === undefined) return p;
    var original = p;
    for (var i = 0; i < MAX_SYMLINK_DEPTH; i++) {
      var target = symlinks[p];
      if (!target) return p;
      p = target;
    }
    var err = new Error(
      "ELOOP: too many symbolic links encountered, '" + original + "'",
    );
    err.code = 'ELOOP';
    err.errno = -40;
    err.syscall = 'stat';
    err.path = original;
    throw err;
  }

  get fileCacheSize() {
    return this._fileCache.size;
  }

  readFileSync(filePath, options) {
    var p = this._resolveSymlink(toManifestKey(filePath));
    // Fast path: for compressed archives, a per-file decompressed Buffer is
    // memoised in _fileCache (decompression is expensive and most prelude
    // modules are read once during module resolution, twice for the compile
    // step).  For uncompressed archives, a direct zero-copy subarray over the
    // embedded archive is cheaper than any cache lookup, so we skip the Map
    // entirely to avoid pinning archive slices we'll never re-read.
    var cached = this._decompress ? this._fileCache.get(p) : undefined;
    var buf;
    if (cached !== undefined) {
      buf = cached;
    } else {
      var entry = this._manifest.offsets[p];
      if (!entry) throw _enoent('open', filePath);
      var off = entry[0];
      var len = entry[1];
      // Validate before subarray — Buffer.subarray clamps silently, so a
      // corrupt manifest would otherwise return truncated bytes instead of
      // surfacing the corruption.  Use Number.isInteger (rejects NaN, ±Inf,
      // and non-integer floats) rather than typeof === 'number'.
      if (
        !Number.isInteger(off) ||
        !Number.isInteger(len) ||
        off < 0 ||
        len < 0 ||
        off + len > this._archive.length
      ) {
        throw new Error(
          'pkg: corrupt SEA manifest — entry [' +
            off +
            ',' +
            len +
            '] out of bounds for archive of ' +
            this._archive.length +
            ' bytes (file: ' +
            filePath +
            ')',
        );
      }
      var slice = this._archive.subarray(off, off + len);
      if (this._decompress) {
        // Cap zlib output at the size the manifest claims for this entry.
        // This does NOT defend against a consistent tamper (an attacker who
        // can rewrite the blob can rewrite `stats[p].size` to match), but it
        // does bound the allocation to whatever the manifest declared — so a
        // broken/corrupt blob with a plausible manifest can't request
        // unbounded memory at startup, and the cap is as generous as the
        // declared file already is.  Validation of stats.size is still
        // load-bearing: maxOutputLength requires a finite number, so NaN /
        // negative / missing values have to be rejected up front.
        var meta = this._manifest.stats[p];
        var maxOutputLength =
          meta && Number.isInteger(meta.size) && meta.size >= 0
            ? meta.size
            : null;
        if (maxOutputLength === null) {
          throw new Error(
            'pkg: corrupt SEA manifest — missing or invalid stats.size for ' +
              filePath,
          );
        }
        buf = this._decompress(slice, { maxOutputLength: maxOutputLength });
        this._fileCache.set(p, buf);
      } else {
        buf = slice;
      }
      perf.count('files loaded');
    }
    var encoding =
      typeof options === 'string' ? options : options && options.encoding;
    // Strings are immutable — safe to derive directly.
    // Buffers are copied before returning so a caller mutation cannot corrupt
    // the archive (uncompressed view) or poison the decompressed cache.
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
// Hand the provider to the perf tracker so finalize() doesn't reach out to
// a module-scope reference — keeps perf self-contained for testing.
perf._provider = provider;
var virtualFs = new VirtualFileSystem(provider);

// Always mount with a POSIX prefix — @roberts_lando/vfs internally relies on
// '/' as path separator (isUnderMountPoint, getRelativePath, etc.).
// Our prototype patches below convert Windows paths to POSIX before they
// reach the VFS, and Node's VFS module hooks use the V: sentinel drive
// for subsequent path resolution, which normalizeVFSPath already handles.
var SNAPSHOT_PREFIX = '/snapshot';

// On Windows, @roberts_lando/vfs normalises with path.normalize() which
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

// POSIX prefix matched on all platforms.  Windows VFS module hooks use the
// V: sentinel drive while dlopen/child_process surface paths under C:, so
// both drive forms (with either separator) are accepted on win32.
var SNAPSHOT_PREFIXES_POSIX = [{ prefix: '/snapshot', sep: '/' }];
var SNAPSHOT_PREFIXES_WIN = [
  { prefix: 'V:\\snapshot', sep: '\\' },
  { prefix: 'V:/snapshot', sep: '/' },
  { prefix: 'C:\\snapshot', sep: '\\' },
  { prefix: 'C:/snapshot', sep: '/' },
];

function insideSnapshot(f) {
  if (typeof f !== 'string') return false;
  var prefixes =
    process.platform === 'win32'
      ? SNAPSHOT_PREFIXES_POSIX.concat(SNAPSHOT_PREFIXES_WIN)
      : SNAPSHOT_PREFIXES_POSIX;
  for (var i = 0; i < prefixes.length; i++) {
    var p = prefixes[i].prefix;
    if (f === p || f.startsWith(p + prefixes[i].sep)) return true;
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
