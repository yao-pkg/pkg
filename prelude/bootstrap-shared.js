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
          fs.cpSync(modulePkgFolder, destFolder, { recursive: true });
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
function setupProcessPkg(entrypoint) {
  process.pkg = {
    entrypoint: entrypoint,
    defaultEntrypoint: entrypoint,
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

module.exports = {
  patchDlopen: patchDlopen,
  patchChildProcess: patchChildProcess,
  setupProcessPkg: setupProcessPkg,
};
