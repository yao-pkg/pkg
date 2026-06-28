import { spawn, spawnSync, ChildProcessByStdio } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Readable, Writable } from 'stream';
import { system } from '@yao-pkg/pkg-fetch';
import { log } from './log';
import { Target } from './types';

const { hostPlatform } = system;

const script = `
  var vm = require('vm');
  var module = require('module');
  var stdin = Buffer.alloc(0);
  process.stdin.on('data', function (data) {
    stdin = Buffer.concat([ stdin, data ]);
    if (stdin.length >= 4) {
      var sizeOfSnap = stdin.readInt32LE(0);
      if (stdin.length >= 4 + sizeOfSnap + 4) {
        var sizeOfBody = stdin.readInt32LE(4 + sizeOfSnap);
        if (stdin.length >= 4 + sizeOfSnap + 4 + sizeOfBody) {
          var snap = stdin.toString('utf8', 4, 4 + sizeOfSnap);
          var body = Buffer.alloc(sizeOfBody);
          var startOfBody = 4 + sizeOfSnap + 4;
          stdin.copy(body, 0, startOfBody, startOfBody + sizeOfBody);
          stdin = Buffer.alloc(0);
          var code = module.wrap(body);
          var s = new vm.Script(code, {
            filename: snap,
            produceCachedData: true,
            sourceless: true
          });
          if (!s.cachedDataProduced) {
            console.error('Pkg: Cached data not produced.');
            process.exit(2);
          }
          var h = Buffer.alloc(4);
          var b = s.cachedData;
          h.writeInt32LE(b.length, 0);
          process.stdout.write(h);
          process.stdout.write(b);
        }
      }
    }
  });
  process.stdin.resume();
`;

// Same compile as `script` above, but the IPC is done through files instead of
// inherited stdin/stdout pipes. This is required for a cross-OS fabricator run
// under an ABI layer (a Windows Node under Wine) which cannot expose inherited
// Unix pipes as Windows stdio handles. Paths arrive via env vars so the child
// never touches process.std* — under Wine those throw `EBADF`. The vm.Script
// call must stay byte-for-byte identical to `script` so the produced bytecode
// is the same.
const fileScript = `
  var vm = require('vm');
  var fs = require('fs');
  var module = require('module');
  var inPath = process.env.PKG_FAB_IN;
  var outPath = process.env.PKG_FAB_OUT;
  var errPath = process.env.PKG_FAB_ERR;
  try {
    var stdin = fs.readFileSync(inPath);
    var sizeOfSnap = stdin.readInt32LE(0);
    var snap = stdin.toString('utf8', 4, 4 + sizeOfSnap);
    var sizeOfBody = stdin.readInt32LE(4 + sizeOfSnap);
    var startOfBody = 4 + sizeOfSnap + 4;
    var body = Buffer.alloc(sizeOfBody);
    stdin.copy(body, 0, startOfBody, startOfBody + sizeOfBody);
    var code = module.wrap(body);
    var s = new vm.Script(code, {
      filename: snap,
      produceCachedData: true,
      sourceless: true
    });
    if (!s.cachedDataProduced) {
      fs.writeFileSync(errPath, 'Pkg: Cached data not produced.');
      process.exit(2);
    }
    var b = s.cachedData;
    var h = Buffer.alloc(4);
    h.writeInt32LE(b.length, 0);
    fs.writeFileSync(outPath, Buffer.concat([ h, b ]));
  } catch (err) {
    try { fs.writeFileSync(errPath, String((err && err.stack) || err)); } catch (e) {}
    process.exit(1);
  }
`;

const children: Record<
  string,
  ChildProcessByStdio<Writable, Readable, null>
> = {};

// Bakes that don't influence the produced bytecode and so are dropped before
// the fabricator is spawned (keeps the persistent-child key stable too).
function bytecodeBakes(bakes: string[]) {
  return bakes.filter((bake) => {
    const bake2 = bake.replace(/_/g, '-');

    return !['--prof', '--v8-options', '--trace-opt', '--trace-deopt'].includes(
      bake2,
    );
  });
}

// True when the fabricator is a Windows binary executed on a non-Windows host,
// i.e. run under Wine via a binfmt_misc MZ handler. The cross-arch (QEMU)
// `linuxstatic` fabricator is NOT included: QEMU user emulation passes stdio
// through fine, so it keeps the faster persistent-pipe path below.
function runsUnderWine(fabricator: Target) {
  return fabricator.platform === 'win' && hostPlatform !== 'win';
}

let fileIpcCounter = 0;

function crossFabricatorError(
  fabricator: Target,
  snap: string,
  wine: boolean,
  detail: string,
): Error {
  const base = `Failed to make bytecode ${fabricator.nodeRange}-${fabricator.arch} for file ${snap}`;
  const hint = wine
    ? ' — building a Windows target on this host runs the target Node under Wine; ' +
      'ensure Wine and a binfmt_misc MZ handler are configured (see the cross-compile guide)'
    : '';
  return new Error(`${base} (${detail})${hint}`);
}

// File-based fabrication. Spawns the fabricator once per file (no persistent
// child) and exchanges the snap/body and the resulting cached data through
// temp files. Exported so the file protocol can be exercised in tests with the
// host Node as the fabricator, independently of Wine.
export function fabricateViaFile(
  bakes: string[],
  fabricator: Target,
  snap: string,
  body: Buffer,
  cb: (error?: Error, buffer?: Buffer) => void,
) {
  const activeBakes = bytecodeBakes(bakes);
  const wine = runsUnderWine(fabricator);

  const uniq = `${process.pid}-${(fileIpcCounter += 1)}-${randomBytes(
    6,
  ).toString('hex')}`;
  const dir = tmpdir();
  const inPath = join(dir, `pkg-fab-${uniq}.in`);
  const outPath = join(dir, `pkg-fab-${uniq}.out`);
  const errPath = join(dir, `pkg-fab-${uniq}.err`);

  // Wine maps the unix filesystem root onto its `Z:` drive, so a win fabricator
  // sees Windows-style paths while we read/write the same files via unix paths.
  const childPath = (p: string) => (wine ? `Z:${p.replace(/\//g, '\\')}` : p);

  const cleanup = () => {
    for (const p of [inPath, outPath, errPath]) {
      try {
        unlinkSync(p);
      } catch {
        /* best-effort */
      }
    }
  };

  try {
    // [int32 snapLen][snap][int32 bodyLen][body]
    const snapBuf = Buffer.from(snap);
    const head1 = Buffer.alloc(4);
    head1.writeInt32LE(snapBuf.length, 0);
    const head2 = Buffer.alloc(4);
    head2.writeInt32LE(body.length, 0);
    writeFileSync(inPath, Buffer.concat([head1, snapBuf, head2, body]));

    const env: NodeJS.ProcessEnv = {
      PKG_EXECPATH: 'PKG_INVOKE_NODEJS',
      PKG_FAB_IN: childPath(inPath),
      PKG_FAB_OUT: childPath(outPath),
      PKG_FAB_ERR: childPath(errPath),
    };

    if (wine) {
      // The native spawn path strips the env entirely; for Wine that drops
      // HOME/WINEPREFIX and breaks. Forward the Wine-relevant vars so a plain
      // `:MZ:…:/usr/bin/wine:` handler works with no wrapper script.
      for (const key of [
        'WINEPREFIX',
        'WINEARCH',
        'WINEDEBUG',
        'WINEDLLOVERRIDES',
        'HOME',
        'XDG_RUNTIME_DIR',
        'PATH',
      ]) {
        const value = process.env[key];
        if (value !== undefined) env[key] = value;
      }
    }

    const stderr = log.debugMode ? 'inherit' : 'ignore';
    const result = spawnSync(
      fabricator.binaryPath,
      activeBakes.concat('--no-warnings', '-e', fileScript),
      { stdio: ['ignore', 'ignore', stderr], env },
    );

    if (result.error) {
      return cb(
        crossFabricatorError(fabricator, snap, wine, result.error.message),
      );
    }

    if (result.status !== 0) {
      let detail = '';
      try {
        detail = readFileSync(errPath, 'utf8');
      } catch {
        /* no error file */
      }
      return cb(
        crossFabricatorError(
          fabricator,
          snap,
          wine,
          detail || `exit code ${result.status}`,
        ),
      );
    }

    const out = readFileSync(outPath);
    const sizeOfBlob = out.readInt32LE(0);
    const blob = Buffer.alloc(sizeOfBlob);
    out.copy(blob, 0, 4, 4 + sizeOfBlob);
    return cb(undefined, blob);
  } catch (error) {
    return cb(
      crossFabricatorError(fabricator, snap, wine, (error as Error).message),
    );
  } finally {
    cleanup();
  }
}

export function fabricate(
  bakes: string[],
  fabricator: Target,
  snap: string,
  body: Buffer,
  cb: (error?: Error, buffer?: Buffer) => void,
) {
  // A Windows fabricator under Wine cannot use inherited stdin/stdout pipes;
  // use the file-based protocol instead. Native and QEMU cross-arch builds keep
  // the persistent-child pipe path below.
  if (runsUnderWine(fabricator)) {
    return fabricateViaFile(bakes, fabricator, snap, body, cb);
  }

  const activeBakes = bytecodeBakes(bakes);

  const cmd = fabricator.binaryPath;
  const key = JSON.stringify([cmd, activeBakes]);
  let child = children[key];

  if (!child) {
    const stderr = log.debugMode ? process.stdout : 'ignore';
    children[key] = spawn(cmd, activeBakes.concat('-e', script), {
      stdio: ['pipe', 'pipe', stderr],
      env: { PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
    });
    child = children[key];
  }

  function kill() {
    delete children[key];
    child.kill();
  }

  let stdout = Buffer.alloc(0);

  function onError(error: Error) {
    removeListeners();
    kill();
    cb(
      new Error(
        `Failed to make bytecode ${fabricator.nodeRange}-${fabricator.arch} for file ${snap} error (${error.message})`,
      ),
    );
  }

  function onClose(code: number) {
    removeListeners();
    kill();
    if (code !== 0) {
      return cb(
        new Error(
          `Failed to make bytecode ${fabricator.nodeRange}-${fabricator.arch} for file ${snap}`,
        ),
      );
    }

    console.log(stdout.toString());
    return cb(new Error(`${cmd} closed unexpectedly`));
  }

  function onData(data: Buffer) {
    stdout = Buffer.concat([stdout, data]);
    if (stdout.length >= 4) {
      const sizeOfBlob = stdout.readInt32LE(0);
      if (stdout.length >= 4 + sizeOfBlob) {
        const blob = Buffer.alloc(sizeOfBlob);
        stdout.copy(blob, 0, 4, 4 + sizeOfBlob);
        removeListeners();
        return cb(undefined, blob);
      }
    }
  }

  function removeListeners() {
    child.removeListener('error', onError);
    child.removeListener('close', onClose);
    child.stdin.removeListener('error', onError);
    child.stdout.removeListener('error', onError);
    child.stdout.removeListener('data', onData);
  }

  child.on('error', onError);
  child.on('close', onClose);
  child.stdin.on('error', onError);
  child.stdout.on('error', onError);
  child.stdout.on('data', onData);

  const h = Buffer.alloc(4);
  let b = Buffer.from(snap);
  h.writeInt32LE(b.length, 0);
  child.stdin.write(h);
  child.stdin.write(b);
  b = body;
  h.writeInt32LE(b.length, 0);
  child.stdin.write(h);
  child.stdin.write(b);
}

export function fabricateTwice(
  bakes: string[],
  fabricator: Target,
  snap: string,
  body: Buffer,
  cb: (error?: Error, buffer?: Buffer) => void,
) {
  fabricate(bakes, fabricator, snap, body, (error, buffer) => {
    // node0 can not produce second time, even if first time produced fine,
    // probably because of 'filename' cache. also, there are weird cases
    // when node4 can not compile as well, for example file 'lib/js-yaml/dumper.js'
    // of package js-yaml@3.9.0 does not get bytecode second time on node4-win-x64
    if (error) return fabricate(bakes, fabricator, snap, body, cb);
    cb(undefined, buffer);
  });
}

export function shutdown() {
  for (const key in children) {
    if (children[key]) {
      const child = children[key];
      delete children[key];
      child.kill();
    }
  }
}
