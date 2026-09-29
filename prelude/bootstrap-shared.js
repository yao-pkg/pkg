'use strict';

// Shared runtime utilities used by both the traditional bootstrap and
// the SEA bootstrap.  Each consumer require()s or inlines this module.
//
// Traditional bootstrap: inlined via REQUIRE_SHARED (already has its
//   own common.ts path helpers via REQUIRE_COMMON) — only calls the
//   functions exported here.
// SEA bootstrap: bundled by esbuild via require('./bootstrap-shared').

var childProcess = require('child_process');
var { createHash } = require('crypto');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var { homedir } = require('os');

// /////////////////////////////////////////////////////////////////
// COMPRESSION CODECS //////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Numeric codec ids. MUST stay in sync with lib/compress_type.ts.  Only
// COMPRESS_NONE is re-exported because sea-vfs-setup reads it directly; the
// pickDecompressor* helpers encapsulate the rest so no consumer needs to
// know the numeric values.
var COMPRESS_NONE = 0;
var COMPRESS_GZIP = 1;
var COMPRESS_BROTLI = 2;
var COMPRESS_ZSTD = 3;

// A SEA binary embeds Node.js, so the end user cannot "upgrade Node" — they
// either need a re-packaged binary or a different codec.  Callers pass the
// name of the missing zlib symbol for easier triage.
function zstdMissingError(symbol) {
  return new Error(
    'pkg: Zstd compression requires Node.js >= 22.15 ' +
      '(runtime missing zlib.' +
      symbol +
      '). Re-package this binary with pkg >= the version that embeds Node ' +
      '22.15+, or contact the distributor for a --compress Brotli/GZip build.',
  );
}

// Return the sync decompressor for the given codec id, or throw a
// uniformly-worded error when the runtime is missing the Zstd API.
function pickDecompressorSync(compression) {
  switch (compression) {
    case COMPRESS_NONE:
      return null;
    case COMPRESS_GZIP:
      return zlib.gunzipSync;
    case COMPRESS_BROTLI:
      return zlib.brotliDecompressSync;
    case COMPRESS_ZSTD:
      if (typeof zlib.zstdDecompressSync !== 'function') {
        throw zstdMissingError('zstdDecompressSync');
      }
      return zlib.zstdDecompressSync;
    default:
      throw new Error(
        'pkg: unknown compression codec id ' + compression + ' in manifest',
      );
  }
}

// Async variant — `cb`-style zlib decompress fns for the payload pipeline.
function pickDecompressorAsync(compression) {
  switch (compression) {
    case COMPRESS_NONE:
      return null;
    case COMPRESS_GZIP:
      return zlib.gunzip;
    case COMPRESS_BROTLI:
      return zlib.brotliDecompress;
    case COMPRESS_ZSTD:
      if (typeof zlib.zstdDecompress !== 'function') {
        throw zstdMissingError('zstdDecompress');
      }
      return zlib.zstdDecompress;
    default:
      throw new Error('pkg: unknown compression codec id ' + compression);
  }
}

// /////////////////////////////////////////////////////////////////
// NATIVE ADDON EXTRACTION /////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Recursively copy src -> dest. For existing destination files, compare
// SHA-256 hashes and skip identical ones to avoid redundant writes.
//
// IMPORTANT: Always run the copy — do NOT guard with existsSync on the folder.
// OS temp cleanup or antivirus can delete files inside the cache directory while
// leaving the directory structure intact. An existsSync check on the directory
// would pass, but the actual .node/.so files inside would be missing, causing
// "module not found" crashes. This was deliberately established in vercel/pkg
// PR #1492 after production incidents. Per-file SHA-256 checksums (PR #1611)
// make this efficient — unchanged files are skipped.
// See also: https://github.com/vercel/pkg/issues/1589
function cpRecursive(src, dest) {
  // lstatSync (not statSync) so we detect symlinks instead of following them.
  // Following could recurse into the symlink target, loop forever, or copy
  // unrelated content that lives outside the addon package tree.
  var st = fs.lstatSync(src);

  if (st.isSymbolicLink()) {
    // Recreate the symlink at the destination instead of dereferencing it.
    var target = fs.readlinkSync(src);
    try {
      fs.unlinkSync(dest);
    } catch (_) {
      /* dest may not exist */
    }
    try {
      fs.symlinkSync(target, dest);
      return;
    } catch (e) {
      // Windows requires admin privileges or developer mode to create
      // symlinks. Fall back to copying the resolved target so native addon
      // extraction still succeeds — the duplicated content is the lesser
      // evil compared to a hard load failure.
      if (e && (e.code === 'EPERM' || e.code === 'EACCES')) {
        var resolved = path.isAbsolute(target)
          ? target
          : path.join(path.dirname(src), target);
        cpRecursive(resolved, dest);
        return;
      }
      throw e;
    }
  }

  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    var entries = fs.readdirSync(src);
    for (var i = 0; i < entries.length; i++) {
      cpRecursive(path.join(src, entries[i]), path.join(dest, entries[i]));
    }
    return;
  }

  // Regular file: read via fs.readFileSync (VFS-routed when src is inside
  // the snapshot), hash the Buffer, then write the same Buffer to the real
  // disk via writeFileSync. We avoid copyFileSync because VFS module hooks
  // intercept readFile but may not intercept copyFile — a copyFileSync from
  // a snapshot path would fail to resolve the source in SEA mode.
  var srcContent = fs.readFileSync(src);
  if (fs.existsSync(dest)) {
    var destContent = fs.readFileSync(dest);
    var srcHash = createHash('sha256').update(srcContent).digest('hex');
    var destHash = createHash('sha256').update(destContent).digest('hex');
    if (srcHash === destHash) {
      return;
    }
  }
  fs.writeFileSync(dest, srcContent);
}

/**
 * Patch process.dlopen to extract native addons from the snapshot to a
 * cache directory on the real filesystem before loading them.
 *
 * @param {function} insideSnapshot  Returns true when a path is inside the virtual snapshot.
 */
function patchDlopen(insideSnapshot) {
  var ancestor = process.dlopen;
  var PKG_NATIVE_CACHE_BASE =
    process.env.PKG_NATIVE_CACHE_PATH || path.join(homedir(), '.cache');

  function revertMakingLong(f) {
    if (/^\\\\\?\\/.test(f)) return f.slice(4);
    return f;
  }

  process.dlopen = function dlopen() {
    var args = Array.prototype.slice.call(arguments);
    var modulePath = revertMakingLong(args[1]);
    var moduleBaseName = path.basename(modulePath);
    var moduleFolder = path.dirname(modulePath);

    if (insideSnapshot(modulePath)) {
      var moduleContent = fs.readFileSync(modulePath);
      var hash = createHash('sha256').update(moduleContent).digest('hex');
      var tmpFolder = path.join(PKG_NATIVE_CACHE_BASE, 'pkg', hash);

      fs.mkdirSync(tmpFolder, { recursive: true });

      var parts = moduleFolder.split(path.sep);
      var mIndex = parts.lastIndexOf('node_modules') + 1;
      var newPath;

      if (mIndex > 0) {
        // Addon inside node_modules — copy the entire package folder to
        // preserve relative paths for statically linked addons (fix #1075)
        var modulePackagePath = parts.slice(mIndex).join(path.sep);
        var modulePkgFolder = parts.slice(0, mIndex + 1).join(path.sep);
        var destFolder = path.join(tmpFolder, path.basename(modulePkgFolder));

        cpRecursive(modulePkgFolder, destFolder);

        newPath = path.join(tmpFolder, modulePackagePath, moduleBaseName);
      } else {
        var tmpModulePath = path.join(tmpFolder, moduleBaseName);

        // Same rationale as above — always verify the file is present and up-to-date,
        // never skip based on directory existence alone (see vercel/pkg PR #1492).
        // Use writeFileSync with the already-read moduleContent instead of
        // copyFileSync because VFS module hooks intercept readFile but may not
        // intercept copyFile — copying a snapshot path via copyFileSync would
        // fail to find the source in SEA mode.
        if (fs.existsSync(tmpModulePath)) {
          var dContent = fs.readFileSync(tmpModulePath);
          var dHash = createHash('sha256').update(dContent).digest('hex');
          if (hash !== dHash) {
            fs.writeFileSync(tmpModulePath, moduleContent);
          }
        } else {
          fs.writeFileSync(tmpModulePath, moduleContent);
        }

        newPath = tmpModulePath;
      }

      args[1] = newPath;
    }

    return ancestor.apply(process, args);
  };
}

// /////////////////////////////////////////////////////////////////
// CHILD_PROCESS PATCHING //////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

/**
 * Patch child_process so that spawning 'node' or the entrypoint from
 * inside a packaged app correctly uses the executable path.
 *
 * @param {string} entrypoint  The snapshotified entrypoint path.
 */
function patchChildProcess(entrypoint) {
  var EXECPATH = process.execPath;
  var ARGV0 = process.argv[0];

  var ancestor = {
    spawn: childProcess.spawn,
    spawnSync: childProcess.spawnSync,
    execFile: childProcess.execFile,
    execFileSync: childProcess.execFileSync,
    exec: childProcess.exec,
    execSync: childProcess.execSync,
  };

  function cloneArgs(args_) {
    return Array.prototype.slice.call(args_);
  }

  function setOptsEnv(args) {
    var pos = args.length - 1;
    if (typeof args[pos] === 'function') pos -= 1;
    if (typeof args[pos] !== 'object' || Array.isArray(args[pos])) {
      pos += 1;
      args.splice(pos, 0, {});
    }
    var opts = args[pos];
    if (!opts.env) opts.env = Object.assign({}, process.env);
    if (opts.env.PKG_EXECPATH !== undefined) return;
    opts.env.PKG_EXECPATH = EXECPATH;
  }

  function startsWith2(args, index, name, impostor) {
    var qsName = '"' + name + ' ';
    if (args[index].slice(0, qsName.length) === qsName) {
      args[index] = '"' + impostor + ' ' + args[index].slice(qsName.length);
      return true;
    }
    var sName = name + ' ';
    if (args[index].slice(0, sName.length) === sName) {
      args[index] = impostor + ' ' + args[index].slice(sName.length);
      return true;
    }
    if (args[index] === name) {
      args[index] = impostor;
      return true;
    }
    return false;
  }

  function startsWith(args, index, name) {
    var qName = '"' + name + '"';
    var qEXECPATH = '"' + EXECPATH + '"';
    var jsName = JSON.stringify(name);
    var jsEXECPATH = JSON.stringify(EXECPATH);
    return (
      startsWith2(args, index, name, EXECPATH) ||
      startsWith2(args, index, qName, qEXECPATH) ||
      startsWith2(args, index, jsName, jsEXECPATH)
    );
  }

  function modifyLong(args, index) {
    if (!args[index]) return;
    return (
      startsWith(args, index, 'node') ||
      startsWith(args, index, ARGV0) ||
      startsWith(args, index, entrypoint) ||
      startsWith(args, index, EXECPATH)
    );
  }

  function modifyShort(args) {
    if (!args[0]) return;
    if (!Array.isArray(args[1])) {
      args.splice(1, 0, []);
    }
    if (
      args[0] === 'node' ||
      args[0] === ARGV0 ||
      args[0] === entrypoint ||
      args[0] === EXECPATH
    ) {
      args[0] = EXECPATH;
    } else {
      for (var i = 1; i < args[1].length; i += 1) {
        var mbc = args[1][i - 1];
        if (mbc === '-c' || mbc === '/c') {
          modifyLong(args[1], i);
        }
      }
    }
  }

  childProcess.spawn = function spawn() {
    var args = cloneArgs(arguments);
    setOptsEnv(args);
    modifyShort(args);
    return ancestor.spawn.apply(childProcess, args);
  };

  childProcess.spawnSync = function spawnSync() {
    var args = cloneArgs(arguments);
    setOptsEnv(args);
    modifyShort(args);
    return ancestor.spawnSync.apply(childProcess, args);
  };

  childProcess.execFile = function execFile() {
    var args = cloneArgs(arguments);
    setOptsEnv(args);
    modifyShort(args);
    return ancestor.execFile.apply(childProcess, args);
  };

  childProcess.execFileSync = function execFileSync() {
    var args = cloneArgs(arguments);
    setOptsEnv(args);
    modifyShort(args);
    return ancestor.execFileSync.apply(childProcess, args);
  };

  childProcess.exec = function exec() {
    var args = cloneArgs(arguments);
    setOptsEnv(args);
    modifyLong(args, 0);
    return ancestor.exec.apply(childProcess, args);
  };

  childProcess.execSync = function execSync() {
    var args = cloneArgs(arguments);
    setOptsEnv(args);
    modifyLong(args, 0);
    return ancestor.execSync.apply(childProcess, args);
  };
}

// /////////////////////////////////////////////////////////////////
// INTL SEGMENTER //////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

/**
 * Replace Intl.Segmenter#segment with a throwing stub when the embedded
 * Node.js has no ICU break-iterator data.
 *
 * pkg-fetch base binaries are built with --with-intl=small-icu, which
 * ships no break-iterator data. V8 only DCHECKs the null
 * icu::BreakIterator returned by BreakIterator::create*Instance, and
 * DCHECKs are compiled out of release builds — so `new Intl.Segmenter()`
 * succeeds and the first .segment() call dereferences null. The result is
 * an uncatchable SIGSEGV with no stack, which is close to undebuggable
 * downstream (nodejs/node#51752, https://issues.chromium.org/issues/531782498).
 *
 * Throwing the RangeError upstream intends to throw once the V8 fix lands
 * costs nothing and makes the failure name its caller.
 */
function patchIntlSegmenter() {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    return;
  }

  var variables = (process.config && process.config.variables) || {};

  // Cheap gate first — full-icu builds are unaffected and pay only this
  // property read.
  if (variables.icu_small !== true) return;

  // icu_small stays true when the user supplies real data through
  // NODE_ICU_DATA / --icu-data-dir, and Segmenter then works, so probe for
  // the data rather than trusting the build flag. Data-less small-icu
  // resolves every locale to the default one; requiring two unrelated
  // locales means no single system locale can mask the check.
  if (
    new Intl.DateTimeFormat('de').resolvedOptions().locale === 'de' &&
    new Intl.DateTimeFormat('ja').resolvedOptions().locale === 'ja'
  ) {
    return;
  }

  var dat = 'icudt' + (variables.icu_ver_major || '') + 'l.dat';

  // Only .segment() is replaced. string-width v7+ — a transitive
  // dependency of ora, boxen, inquirer and cli-table3 — constructs a
  // Segmenter at module scope, so removing the constructor would break
  // those imports outright instead of at the point of use.
  Intl.Segmenter.prototype.segment = function segment() {
    throw new RangeError(
      'pkg: Intl.Segmenter is unavailable in this executable. It embeds a ' +
        'small-icu Node.js build with no break-iterator data, where calling ' +
        'segment() would crash the process (nodejs/node#51752). Re-package ' +
        'with --sea, which uses full-icu official Node.js binaries, or set ' +
        'NODE_ICU_DATA to a directory containing ' +
        dat +
        '.',
    );
  };
}

// /////////////////////////////////////////////////////////////////
// PROCESS.PKG SETUP ///////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

/**
 * Set up the process.pkg compatibility object.
 *
 * @param {string} entrypoint  The snapshotified entrypoint path.
 */
function setupProcessPkg(entrypoint, defaultEntrypoint) {
  process.pkg = {
    entrypoint: entrypoint,
    defaultEntrypoint:
      defaultEntrypoint !== undefined ? defaultEntrypoint : entrypoint,
    path: {
      resolve: function () {
        var args = [path.dirname(entrypoint)];
        for (var i = 0; i < arguments.length; i++) {
          args.push(arguments[i]);
        }
        return path.resolve.apply(path, args);
      },
    },
  };
}

// /////////////////////////////////////////////////////////////////
// RUNTIME DIAGNOSTICS /////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

function humanSize(bytes) {
  var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  if (bytes === 0) return 'n/a';

  var i = Math.floor(Math.log(bytes) / Math.log(1024));

  if (i === 0) return bytes + ' ' + sizes[i];

  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

/**
 * Install runtime diagnostics triggered by the DEBUG_PKG environment
 * variable.  Works identically in both traditional and SEA modes.
 *
 *   DEBUG_PKG=1  — dump the virtual file system tree and oversized files
 *   DEBUG_PKG=2  — also wrap every fs/fs.promises call with console.log
 *
 * Note: DEBUG_PKG requires the binary to be built with --debug / -d.
 *
 * Additionally, for SEA binaries (any build, not just --debug):
 *
 *   DEBUG_PKG_PERF=1  — print VFS performance report at startup showing
 *                        phase timings (manifest parse, module loading, etc.)
 *                        and provider counters (files loaded, stat calls, etc.)
 *
 * @param {string} snapshotPrefix  The snapshot mount prefix ('/snapshot' or 'C:\\snapshot').
 */
function installDiagnostic(snapshotPrefix) {
  if (!process.env.DEBUG_PKG) return;

  var sizeLimit = process.env.SIZE_LIMIT_PKG
    ? parseInt(process.env.SIZE_LIMIT_PKG, 10)
    : 5 * 1024 * 1024;
  var folderLimit = process.env.FOLDER_LIMIT_PKG
    ? parseInt(process.env.FOLDER_LIMIT_PKG, 10)
    : 10 * 1024 * 1024;

  var overSized = [];

  function dumpLevel(filename, level, tree) {
    var totalSize = 0;
    var d = fs.readdirSync(filename);
    for (var j = 0; j < d.length; j += 1) {
      var f = path.join(filename, d[j]);
      var realPath;
      try {
        realPath = fs.realpathSync(f);
      } catch (_) {
        realPath = f;
      }
      var isSymbolicLink = f !== realPath;

      var s = fs.statSync(f);

      if (s.isDirectory() && !isSymbolicLink) {
        var tree1 = [];
        var startIndex = overSized.length;
        var folderSize = dumpLevel(f, level + 1, tree1);
        totalSize += folderSize;
        var str =
          (' '.padStart(level * 2, ' ') + d[j]).padEnd(40, ' ') +
          (humanSize(folderSize).padStart(10, ' ') +
            (isSymbolicLink ? '=> ' + realPath : ' '));
        tree.push(str);
        tree1.forEach(function (x) {
          tree.push(x);
        });

        if (folderSize > folderLimit) {
          overSized.splice(startIndex, 0, str);
        }
      } else {
        totalSize += s.size;
        var str2 =
          (' '.padStart(level * 2, ' ') + d[j]).padEnd(40, ' ') +
          (humanSize(s.size).padStart(10, ' ') +
            (isSymbolicLink ? '=> ' + realPath : ' '));

        if (s.size > sizeLimit) {
          overSized.push(str2);
        }

        tree.push(str2);
      }
    }
    return totalSize;
  }

  function wrap(obj, name) {
    var f = obj[name];
    if (typeof f !== 'function') return;
    obj[name] = function () {
      var args1 = Array.prototype.slice.call(arguments);
      console.log(
        'fs.' + name,
        args1.filter(function (x) {
          return typeof x === 'string';
        }),
      );
      return f.apply(this, args1);
    };
  }

  console.log('------------------------------- virtual file system');
  console.log(snapshotPrefix);

  var tree = [];
  var totalSize = dumpLevel(snapshotPrefix, 1, tree);
  console.log(tree.join('\n'));
  console.log('Total size = ', humanSize(totalSize));

  if (overSized.length > 0) {
    console.log('------------------------------- oversized files');
    console.log(overSized.join('\n'));
  }

  if (process.env.DEBUG_PKG === '2') {
    wrap(fs, 'openSync');
    wrap(fs, 'open');
    wrap(fs, 'readSync');
    wrap(fs, 'read');
    wrap(fs, 'readFile');
    wrap(fs, 'writeSync');
    wrap(fs, 'write');
    wrap(fs, 'closeSync');
    wrap(fs, 'readFileSync');
    wrap(fs, 'close');
    wrap(fs, 'readdirSync');
    wrap(fs, 'readdir');
    wrap(fs, 'realpathSync');
    wrap(fs, 'realpath');
    wrap(fs, 'readlinkSync');
    wrap(fs, 'readlink');
    wrap(fs, 'statSync');
    wrap(fs, 'stat');
    wrap(fs, 'lstatSync');
    wrap(fs, 'lstat');
    wrap(fs, 'fstatSync');
    wrap(fs, 'fstat');
    wrap(fs, 'existsSync');
    wrap(fs, 'exists');
    wrap(fs, 'accessSync');
    wrap(fs, 'access');

    if (fs.promises) {
      wrap(fs.promises, 'open');
      wrap(fs.promises, 'read');
      wrap(fs.promises, 'readFile');
      wrap(fs.promises, 'write');
      wrap(fs.promises, 'readdir');
      wrap(fs.promises, 'realpath');
      wrap(fs.promises, 'readlink');
      wrap(fs.promises, 'stat');
      wrap(fs.promises, 'lstat');
      wrap(fs.promises, 'access');
      wrap(fs.promises, 'copyFile');
    }
  }
}

// /////////////////////////////////////////////////////////////////
// SYMLINK PROCESSING //////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

// Matches the typical Linux SYMLOOP_MAX. Bounds symlink resolution so a
// manifest cycle (or a corrupt manifest) cannot hang startup.
var MAX_SYMLINK_DEPTH = 40;

// libuv numbers errnos differently on Windows (uv/errno.h). One table for both
// preludes: they were drifting apart, and sea-vfs-setup.js's ENOENT was not
// Windows-aware at all. Positive constants, negated at use.
var ERRNO = (function () {
  var windows = process.platform === 'win32';
  return {
    ENOTDIR: windows ? 4052 : 20,
    ENOENT: windows ? 4058 : 2,
    EISDIR: windows ? 4068 : 21,
    EINVAL: windows ? 4071 : 22,
    ELOOP: windows ? 4067 : 40,
  };
})();

/**
 * One shape for every error the two preludes raise from a snapshot path.
 *
 * The *message* deliberately stays the caller's: traditional mode's ENOENT
 * carries pkg's "recompile adding it as asset" guidance (asserted by
 * test-50-not-found-wording), while the SEA provider uses Node's own wording.
 * What has to match is the shape — code, errno, syscall, path, and the `pkg`
 * marker bootstrap.js's module wrapper reads.
 */
function makeFsError(message, code, syscall, path_) {
  var err = new Error(message);
  err.code = code;
  err.errno = -ERRNO[code];
  err.syscall = syscall;
  err.path = path_;
  err.pkg = true;
  return err;
}

// Marks a symlink key whose resolution is still on the stack, so a cycle
// (/a -> /b -> /a, or /a -> /a/b) is caught instead of recursing forever.
var RESOLVING = {};

// libuv dirent types, as readdir({ withFileTypes: true }) reports them.
var UV_DIRENT_FILE = 1;
var UV_DIRENT_DIR = 2;
var UV_DIRENT_LINK = 3;

// POSIX file-type bits, for stats that have to agree with the predicate above.
var S_IFMT = 0o170000;
var S_IFLNK = 0o120000;

/**
 * The Dirent both bootstraps hand back from readdir({ withFileTypes: true }).
 *
 * fs.Dirent.isSymbolicLink() takes no argument, so link status has to be baked
 * in at construction — which is why the type is passed rather than derived
 * from a later lookup.
 */
function Dirent(name, type, parentPath) {
  this.name = name;
  this.type = type;
  // Node's Dirent has carried parentPath since 20.12, and `path` is its
  // deprecated alias. path.join(d.parentPath, d.name) is the documented way to
  // use withFileTypes, so leaving it undefined throws ERR_INVALID_ARG_TYPE
  // inside a packaged binary.
  this.parentPath = parentPath;
  this.path = parentPath;
}

Dirent.prototype.isDirectory = function isDirectory() {
  return this.type === UV_DIRENT_DIR;
};

Dirent.prototype.isFile = function isFile() {
  return this.type === UV_DIRENT_FILE;
};

Dirent.prototype.isSymbolicLink = function isSymbolicLink() {
  return this.type === UV_DIRENT_LINK;
};

function direntNoop() {
  return false;
}

/**
 * readlink takes its options as a string encoding or an { encoding } object,
 * and answers a Buffer for 'buffer'. Shared so the two modes cannot disagree.
 */
function readlinkEncoding(options) {
  var encoding =
    typeof options === 'string' ? options : options && options.encoding;
  if (encoding && encoding !== 'buffer' && !Buffer.isEncoding(encoding)) {
    var err = new TypeError('Unknown encoding: ' + encoding);
    err.code = 'ERR_INVALID_ARG_VALUE';
    throw err;
  }
  return encoding;
}

function applyReadlinkEncoding(target, encoding) {
  if (encoding === 'buffer') return Buffer.from(target);
  if (encoding && encoding !== 'utf8' && encoding !== 'utf-8') {
    return Buffer.from(target).toString(encoding);
  }
  return target;
}

Dirent.prototype.isBlockDevice = direntNoop;
Dirent.prototype.isCharacterDevice = direntNoop;
Dirent.prototype.isSocket = direntNoop;
Dirent.prototype.isFIFO = direntNoop;

/**
 * Give a stat object symlink semantics.
 *
 * Both walkers stat *through* the link, so what arrives describes the target.
 * The mode's type bits are rewritten too: consumers that sniff
 * `mode & S_IFMT` (tar, archiver, fs.cp) read those rather than the predicate.
 */
function asSymlinkStat(s, target) {
  s.isSymbolicLink = function () {
    return true;
  };
  s.isFile = direntNoop;
  s.isDirectory = direntNoop;
  if (typeof s.mode === 'number') {
    s.mode = (s.mode & ~S_IFMT) | S_IFLNK;
  }
  // POSIX lstat reports a link's size as the length of its target string, and
  // a link occupies no blocks. Without the target we leave the through-the-link
  // numbers alone rather than invent one.
  if (typeof target === 'string') {
    s.size = Buffer.byteLength(target);
    s.blocks = 0;
    s.nlink = 1;
  }
  return s;
}

/**
 * Build a symlink resolver over a manifest's symlinks record.
 *
 * The returned function maps a virtual path onto what its symlinks point at,
 * following parent components the way POSIX does: `node_modules/@x/y` being a
 * link makes `node_modules/@x/y/package.json` resolve too (#295).
 *
 * This runs before every fs operation inside a packaged binary (~30K times at
 * startup on a large project). The empty-manifest case is allocation-free; the
 * no-match case costs one `slice` per depth that actually hosts a key, not one
 * per path component (see `depthHasKey` below).
 *
 * The returned resolver keeps hop-accounting state in its closure, so it is not
 * reentrant — never call it from inside its own resolution.
 */
function makeSymlinkResolver(symlinks, sep) {
  var keys = Object.keys(symlinks || {});

  // Nothing to resolve: hand back identity, so no caller needs a guard of its
  // own and a symlink-free binary pays nothing. It still has to carry .parent,
  // or readlink and lstat break on every binary without symlinks — which is
  // most of them.
  if (keys.length === 0) {
    var identity = function (p) {
      return p;
    };
    identity.parent = identity;
    return identity;
  }

  // Symlink keys sit at a handful of depths — a package manager's links all
  // live at the same level of node_modules. Recording which separator counts
  // can host a key lets the walk below slice only at those depths and stop
  // past the deepest one: for a 15-segment path in a tree whose links live at
  // depth 4, that is one probe instead of fifteen.
  var depthHasKey = [];
  var maxDepth = 0;
  for (var i = 0; i < keys.length; i++) {
    var depth = 0;
    var at = keys[i].indexOf(sep, 1);
    while (at > 0) {
      depth++;
      at = keys[i].indexOf(sep, at + 1);
    }
    depthHasKey[depth] = true;
    if (depth > maxDepth) maxDepth = depth;
  }

  // Symlink key -> { target, cost }: where the key fully resolves to, and how
  // many hops that took. Keyed by manifest entry rather than by the caller's
  // path, so the map stays bounded by the manifest no matter how many distinct
  // paths are looked up — including ones an application derives from untrusted
  // input. It also amortizes across siblings: every file under one linked
  // directory reuses a single entry.
  var resolved = new Map();

  // High-water hop count of the resolution currently in flight. follow() reads
  // it to record each key's `cost`, so a cache hit can charge the hops the
  // collapsed chain stands for instead of getting them for free — otherwise
  // MAX_SYMLINK_DEPTH would depend on which path happened to be looked up
  // first.
  var deepest = 0;

  // Syscall reported by any ELOOP raised by the resolution in flight. Held in
  // the closure rather than threaded through resolve()/follow(), which are on
  // the startup hot path.
  var syscall = 'stat';

  function eloop(origin) {
    return makeFsError(
      'ELOOP: too many symbolic links encountered, ' +
        syscall +
        " '" +
        origin +
        "'",
      'ELOOP',
      syscall,
      origin,
    );
  }

  function follow(key, origin, hops) {
    var cached = resolved.get(key);
    if (cached !== undefined) {
      if (cached === RESOLVING) throw eloop(origin);
      var reached = hops + cached.cost;
      if (reached > MAX_SYMLINK_DEPTH) throw eloop(origin);
      if (reached > deepest) deepest = reached;
      return cached.target;
    }
    resolved.set(key, RESOLVING);
    // Restart the high-water mark at this key's depth so `cost` measures this
    // subtree alone, then fold it back into the caller's mark on the way out.
    var outer = deepest;
    deepest = hops;
    var target;
    try {
      target = resolve(symlinks[key], origin, hops + 1);
    } catch (e) {
      // Don't leave the sentinel behind, or a caught ELOOP would poison this
      // key for every later lookup.
      resolved.delete(key);
      throw e;
    }
    resolved.set(key, { target: target, cost: deepest - hops });
    if (outer > deepest) deepest = outer;
    return target;
  }

  function resolve(p, origin, hops) {
    if (hops > MAX_SYMLINK_DEPTH) throw eloop(origin);
    if (hops > deepest) deepest = hops;

    // Longest prefix wins. The walker keys every entry on the *unresolved*
    // path it walked (`appendSymlink` in lib/walker.ts) and each target is
    // already fully realpath'd, so the deepest key describes the whole chain
    // while a shallower one would strand the walk on a path the archive has no
    // entry for. `<dir>/lib` and `<dir>/lib/sub` can both be keys. An exact
    // match is just the deepest case, so it short-circuits the scan below.
    //
    // Deepest-prefix-first is not POSIX's leftmost-first, and the two agree
    // only because every target the walker records is already a full realpath
    // (`toNormalizedRealPath` in lib/walker.ts), so no component of a target
    // can itself be a key. A hand-written manifest that breaks that invariant
    // would resolve differently here than on disk.
    if (typeof symlinks[p] === 'string') return follow(p, origin, hops);

    var bestPos = -1;
    var bestKey = null;
    var pos = p.indexOf(sep, 1);
    var depth = 0;
    while (pos > 0 && depth <= maxDepth) {
      if (depthHasKey[depth]) {
        var prefix = p.slice(0, pos);
        // typeof, not truthiness: the record is JSON-derived and read with a
        // bracket index, so `__proto__`/`constructor`/`toString` would
        // otherwise match on an inherited, non-string value.
        if (typeof symlinks[prefix] === 'string') {
          bestPos = pos;
          bestKey = prefix;
        }
      }
      pos = p.indexOf(sep, pos + 1);
      depth++;
    }

    if (bestKey === null) return p;

    var target = follow(bestKey, origin, hops);
    // Drop the remainder's leading separator when the target already ends in
    // one, so the join cannot double up.
    var rest = target.endsWith(sep) ? p.slice(bestPos + 1) : p.slice(bestPos);
    // The remainder may hold links of its own, so walk the result.
    return resolve(target + rest, origin, hops + 1);
  }

  function resolveKey(p, forSyscall, forPath) {
    deepest = 0;
    syscall = forSyscall || 'stat';
    // forPath is what an ELOOP reports. Callers pass the user's path, because
    // `p` is a vfs key — base36 under DOCOMPRESS, and never what was asked for.
    return resolve(p, forPath === undefined ? p : forPath, 0);
  }

  // The key a path has once its *parents* are followed but its own last
  // component is not — what POSIX resolves before reading a link, so readlink
  // and lstat can find an entry the walker recorded under a followed parent.
  // Shared so the two modes cannot grow their own join rules.
  resolveKey.parent = function (p, forSyscall, forPath) {
    var slash = p.lastIndexOf(sep);
    if (slash <= 0) return p;
    var parent = resolveKey(p.slice(0, slash), forSyscall, forPath);
    // Drop the remainder's leading separator when the resolved parent already
    // ends in one, so the join cannot produce `//name` and silently miss.
    return (
      parent + (parent.endsWith(sep) ? p.slice(slash + 1) : p.slice(slash))
    );
  };

  return resolveKey;
}

module.exports = {
  patchDlopen: patchDlopen,
  patchChildProcess: patchChildProcess,
  patchIntlSegmenter: patchIntlSegmenter,
  setupProcessPkg: setupProcessPkg,
  installDiagnostic: installDiagnostic,
  COMPRESS_NONE: COMPRESS_NONE,
  pickDecompressorSync: pickDecompressorSync,
  pickDecompressorAsync: pickDecompressorAsync,
  makeSymlinkResolver: makeSymlinkResolver,
  ERRNO: ERRNO,
  makeFsError: makeFsError,
  Dirent: Dirent,
  asSymlinkStat: asSymlinkStat,
  readlinkEncoding: readlinkEncoding,
  applyReadlinkEncoding: applyReadlinkEncoding,
  UV_DIRENT_FILE: UV_DIRENT_FILE,
  UV_DIRENT_DIR: UV_DIRENT_DIR,
  UV_DIRENT_LINK: UV_DIRENT_LINK,
};
