import { spawn, ChildProcessByStdio } from 'child_process';
import { Readable, Writable } from 'stream';
import { log } from './log';
import { Target } from './types';

const FABRICATOR_MAX_FRAME_PART_SIZE = 256 * 1024 * 1024;

export const fabricatorScript = `
  var vm = require('vm');
  var module = require('module');
  var MAX_FRAME_PART_SIZE = ${FABRICATOR_MAX_FRAME_PART_SIZE};
  var stdin = Buffer.alloc(0);
  process.stdin.on('data', function (data) {
    stdin = Buffer.concat([ stdin, data ]);
    while (stdin.length >= 4) {
      var sizeOfSnap = stdin.readInt32LE(0);
      if (sizeOfSnap < 0 || sizeOfSnap > MAX_FRAME_PART_SIZE) {
        console.error('Pkg: Invalid snap size header: ' + sizeOfSnap);
        process.exit(2);
      }
      if (stdin.length < 4 + sizeOfSnap + 4) break;
      var sizeOfBody = stdin.readInt32LE(4 + sizeOfSnap);
      if (sizeOfBody < 0 || sizeOfBody > MAX_FRAME_PART_SIZE) {
        console.error('Pkg: Invalid body size header: ' + sizeOfBody);
        process.exit(2);
      }
      var totalSize = 4 + sizeOfSnap + 4 + sizeOfBody;
      if (stdin.length < totalSize) break;

      var snap = stdin.toString('utf8', 4, 4 + sizeOfSnap);
      var body = Buffer.alloc(sizeOfBody);
      var startOfBody = 4 + sizeOfSnap + 4;
      stdin.copy(body, 0, startOfBody, startOfBody + sizeOfBody);

      // Preserve unconsumed bytes for subsequent payloads
      stdin = stdin.subarray(totalSize);

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
  });
  process.stdin.resume();
`;

const children: Record<
  string,
  ChildProcessByStdio<Writable, Readable, Readable | null>
> = {};

export function buildFabricatorRequestChunks(
  snap: string,
  body: Buffer,
): [Buffer, Buffer, Buffer, Buffer] {
  const snapBuf = Buffer.from(snap);

  if (snapBuf.length > FABRICATOR_MAX_FRAME_PART_SIZE) {
    throw new Error(
      `Fabricator snap exceeds max frame size (${snapBuf.length} bytes)`,
    );
  }

  if (body.length > FABRICATOR_MAX_FRAME_PART_SIZE) {
    throw new Error(
      `Fabricator body exceeds max frame size (${body.length} bytes)`,
    );
  }

  // Keep separate header buffers so async stream writes cannot mutate
  // previously queued bytes.
  const h1 = Buffer.alloc(4);
  h1.writeInt32LE(snapBuf.length, 0);

  const h2 = Buffer.alloc(4);
  h2.writeInt32LE(body.length, 0);

  return [h1, snapBuf, h2, body];
}

export function fabricate(
  bakes: string[],
  fabricator: Target,
  snap: string,
  body: Buffer,
  cb: (error?: Error, buffer?: Buffer) => void,
) {
  const activeBakes = bakes.filter((bake) => {
    // list of bakes that don't influence the bytecode
    const bake2 = bake.replace(/_/g, '-');

    return !['--prof', '--v8-options', '--trace-opt', '--trace-deopt'].includes(
      bake2,
    );
  });

  const cmd = fabricator.binaryPath;
  const key = JSON.stringify([cmd, activeBakes]);
  let child = children[key];

  if (!child) {
    children[key] = spawn(cmd, activeBakes.concat('-e', fabricatorScript), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
    });
    child = children[key];

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        log.debug(`fabricator: ${data.toString().trim()}`);
      });
    }
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

    if (stdout.length > 0) {
      log.debug(`fabricator: unexpected close output: ${stdout.toString()}`);
    }
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

  let requestChunks: [Buffer, Buffer, Buffer, Buffer];
  try {
    requestChunks = buildFabricatorRequestChunks(snap, body);
  } catch (error) {
    removeListeners();
    return cb(
      new Error(
        `Failed to make bytecode ${fabricator.nodeRange}-${fabricator.arch} for file ${snap} error (${(error as Error).message})`,
      ),
    );
  }

  for (const chunk of requestChunks) {
    child.stdin.write(chunk);
  }
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
