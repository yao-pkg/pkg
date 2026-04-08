'use strict';

// Shared runtime utilities used by both the traditional bootstrap and
// the SEA bootstrap.  Each consumer require()s or inlines this module.
//
// Traditional bootstrap: inlined via REQUIRE_COMMON (already has its
//   own common.ts path helpers) — only calls the functions exported here.
// SEA bootstrap: bundled by esbuild via require('./bootstrap-shared').

var childProcess = require('child_process');
var { createHash } = require('crypto');
var fs = require('fs');
var path = require('path');
var { homedir } = require('os');

// /////////////////////////////////////////////////////////////////
// NATIVE ADDON EXTRACTION /////////////////////////////////////////
// /////////////////////////////////////////////////////////////////

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

        if (!fs.existsSync(destFolder)) {
          // Use patched fs primitives instead of fs.cpSync which may not
          // be routed through the VFS in SEA mode.
          (function cpRecursive(src, dest) {
            var st = fs.statSync(src);
            if (st.isDirectory()) {
              fs.mkdirSync(dest, { recursive: true });
              var entries = fs.readdirSync(src);
              for (var i = 0; i < entries.length; i++) {
                cpRecursive(
                  path.join(src, entries[i]),
                  path.join(dest, entries[i]),
                );
              }
            } else {
              // Use readFileSync+writeFileSync instead of copyFileSync because
              // copyFileSync may not be routed through the VFS in SEA mode.
              fs.writeFileSync(dest, fs.readFileSync(src));
            }
          })(modulePkgFolder, destFolder);
        }
        newPath = path.join(tmpFolder, modulePackagePath, moduleBaseName);
      } else {
        var tmpModulePath = path.join(tmpFolder, moduleBaseName);

        if (!fs.existsSync(tmpModulePath)) {
          fs.copyFileSync(modulePath, tmpModulePath);
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
      wrap(fs.promises, 'stat');
      wrap(fs.promises, 'lstat');
      wrap(fs.promises, 'access');
      wrap(fs.promises, 'copyFile');
    }
  }
}

module.exports = {
  patchDlopen: patchDlopen,
  patchChildProcess: patchChildProcess,
  setupProcessPkg: setupProcessPkg,
  installDiagnostic: installDiagnostic,
};
