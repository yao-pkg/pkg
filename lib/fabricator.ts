import { spawn, ChildProcessByStdio } from 'child_process';
import { Readable, Writable } from 'stream';
import { log } from './log';
import { Target } from './types';

// Upper bound for one framed part (snap path or file body). Bodies are
// per-file source buffers and `module.wrap` already caps at Node's 512MB
// string limit, so this ceiling cannot reject a payload that previously
// worked. See docs/ARCHITECTURE.md for the framing description.
export const FABRICATOR_MAX_FRAME_PART_SIZE = 256 * 1024 * 1024;

// Exit code for framing violations (corrupt size headers). Distinct from
// exit 2, which means a well-formed request V8 refused to compile, so a
// desynced pipe can never silently degrade to `--fallback-to-source`.
export const FABRICATOR_PROTOCOL_EXIT_CODE = 3;

// A child that accepts a valid frame and then never answers must not stall
// the build forever. There is no other timeout on this path.
export const FABRICATOR_RESPONSE_TIMEOUT_MS = 60 * 1000;

// Bounded tail of child stderr kept per child and attached to failures so
// non-debug users see the cause (e.g. `Pkg: Cached data not produced.`).
export const FABRICATOR_STDERR_TAIL_MAX_BYTES = 16 * 1024;

const FABRICATOR_CLOSE_SNIPPET_MAX_CHARS = 512;

export const fabricatorScript = `
  var vm = require('vm');
  var module = require('module');
  var MAX_FRAME_PART_SIZE = ${FABRICATOR_MAX_FRAME_PART_SIZE};
  var PROTOCOL_EXIT_CODE = ${FABRICATOR_PROTOCOL_EXIT_CODE};
  var stdin = Buffer.alloc(0);
  process.stdin.on('data', function (data) {
    stdin = Buffer.concat([ stdin, data ]);
    while (stdin.length >= 4) {
      var sizeOfSnap = stdin.readInt32LE(0);
      if (sizeOfSnap < 0 || sizeOfSnap > MAX_FRAME_PART_SIZE) {
        console.error('Pkg: Invalid snap size header: ' + sizeOfSnap);
        process.exit(PROTOCOL_EXIT_CODE);
      }
      if (stdin.length < 4 + sizeOfSnap + 4) break;
      var sizeOfBody = stdin.readInt32LE(4 + sizeOfSnap);
      if (sizeOfBody < 0 || sizeOfBody > MAX_FRAME_PART_SIZE) {
        console.error('Pkg: Invalid body size header: ' + sizeOfBody);
        process.exit(PROTOCOL_EXIT_CODE);
      }
      var totalSize = 4 + sizeOfSnap + 4 + sizeOfBody;
      if (stdin.length < totalSize) break;

      var snap = stdin.toString('utf8', 4, 4 + sizeOfSnap);
      var body = Buffer.alloc(sizeOfBody);
      var startOfBody = 4 + sizeOfSnap + 4;
      stdin.copy(body, 0, startOfBody, startOfBody + sizeOfBody);

      // Preserve unconsumed bytes for subsequent payloads, without pinning
      // a large backing store behind a small tail.
      var rest = stdin.subarray(totalSize);
      if (rest.length === 0) {
        stdin = Buffer.alloc(0);
      } else if (totalSize > 65536 && rest.length * 4 < totalSize) {
        stdin = Buffer.from(rest);
      } else {
        stdin = rest;
      }

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

export type FabricatorFrameParseResult =
  | { status: 'ok'; frame: Buffer; remainder: Buffer }
  | { status: 'incomplete' }
  | { status: 'protocol-error'; message: string };

// Single source of truth for the response side of the frame protocol:
// accumulate, validate the header against the shared max, slice one frame,
// keep the remainder. Used by the parent decoder; the child script keeps
// its own inline copy since it must stay self-contained `-e` source text.
export function tryParseFabricatorResponse(
  buffer: Buffer,
): FabricatorFrameParseResult {
  if (buffer.length < 4) {
    return { status: 'incomplete' };
  }

  const sizeOfBlob = buffer.readInt32LE(0);

  if (sizeOfBlob < 0 || sizeOfBlob > FABRICATOR_MAX_FRAME_PART_SIZE) {
    return {
      status: 'protocol-error',
      message: `Invalid blob size header: ${sizeOfBlob}`,
    };
  }

  if (buffer.length < 4 + sizeOfBlob) {
    return { status: 'incomplete' };
  }

  const frame = Buffer.alloc(sizeOfBlob);
  buffer.copy(frame, 0, 4, 4 + sizeOfBlob);

  // Copy the tail so leftover bytes never pin the whole backing store.
  const remainder = Buffer.from(buffer.subarray(4 + sizeOfBlob));

  return { status: 'ok', frame, remainder };
}

export function checkFabricatorFramePartSize(
  label: 'snap' | 'body',
  byteLength: number,
): void {
  if (byteLength > FABRICATOR_MAX_FRAME_PART_SIZE) {
    const error = new Error(
      `Fabricator ${label} exceeds max frame size (${byteLength} bytes)`,
    );
    (error as NodeJS.ErrnoException).code = 'FABRICATOR_FRAME_TOO_LARGE';
    throw error;
  }
}

export function isDeterministicFabricatorError(error?: Error | null): boolean {
  return (
    !!error &&
    (error as NodeJS.ErrnoException).code === 'FABRICATOR_FRAME_TOO_LARGE'
  );
}

export function fabricatorProtocolError(message: string): Error {
  const error = new Error(`FABRICATOR_PROTOCOL: ${message}`);
  (error as NodeJS.ErrnoException).code = 'FABRICATOR_PROTOCOL';
  return error;
}

export function isFabricatorProtocolError(error?: Error | null): boolean {
  return (
    !!error && (error as NodeJS.ErrnoException).code === 'FABRICATOR_PROTOCOL'
  );
}

// Printable-safe snippet for error messages. JSON.stringify escapes rather
// than dumping raw (possibly binary) bytes to the terminal.
export function toPrintableSnippet(
  buffer: Buffer,
  maxChars: number = FABRICATOR_CLOSE_SNIPPET_MAX_CHARS,
): string {
  return JSON.stringify(buffer.toString('utf8').trim().slice(0, maxChars));
}

interface FabricatorChildState {
  proc: ChildProcessByStdio<Writable, Readable, Readable>;
  // Unconsumed response bytes. The child may pipeline answers while the
  // parent still holds earlier ones; the remainder belongs to the next call.
  stdoutBuf: Buffer;
  stderrTail: Buffer[];
  stderrTailLength: number;
}

const children: Record<string, FabricatorChildState> = {};

function appendStderrTail(state: FabricatorChildState, data: Buffer) {
  state.stderrTail.push(data);
  state.stderrTailLength += data.length;

  while (
    state.stderrTailLength > FABRICATOR_STDERR_TAIL_MAX_BYTES &&
    state.stderrTail.length > 1
  ) {
    const shifted = state.stderrTail.shift() as Buffer;
    state.stderrTailLength -= shifted.length;
  }
}

function stderrTailText(state: FabricatorChildState): string {
  if (state.stderrTailLength === 0) {
    return '';
  }

  return Buffer.concat(state.stderrTail).toString('utf8').trim().slice(0, 2000);
}

export function buildFabricatorRequestChunks(
  snap: string,
  body: Buffer,
): Buffer[] {
  const snapBuf = Buffer.from(snap);

  checkFabricatorFramePartSize('snap', snapBuf.length);
  checkFabricatorFramePartSize('body', body.length);

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

  if (!children[key]) {
    const proc = spawn(cmd, activeBakes.concat('-e', fabricatorScript), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
    });
    const state: FabricatorChildState = {
      proc,
      stdoutBuf: Buffer.alloc(0),
      stderrTail: [],
      stderrTailLength: 0,
    };
    children[key] = state;

    proc.stderr.on('data', (data: Buffer) => {
      appendStderrTail(state, data);

      if (log.debugMode) {
        log.debug(`fabricator: ${data.toString().trim()}`);
      }
    });
  }

  const state = children[key];
  const child = state.proc;
  let settled = false;

  function tailSuffix(): string {
    const tail = stderrTailText(state);
    return tail ? ` stderr: ${tail}` : '';
  }

  function kill() {
    delete children[key];
    child.kill();
  }

  const timer = setTimeout(() => {
    if (settled) {
      return;
    }

    settled = true;
    removeListeners();
    kill();
    cb(
      fabricatorProtocolError(
        `timed out after ${FABRICATOR_RESPONSE_TIMEOUT_MS}ms waiting for bytecode ${fabricator.nodeRange}-${fabricator.arch} for file ${snap}${tailSuffix()}`,
      ),
    );
  }, FABRICATOR_RESPONSE_TIMEOUT_MS);

  function onError(error: Error) {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);
    removeListeners();
    kill();
    cb(
      new Error(
        `Failed to make bytecode ${fabricator.nodeRange}-${fabricator.arch} for file ${snap} error (${error.message})${tailSuffix()}`,
      ),
    );
  }

  function onClose(code: number | null) {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);
    removeListeners();
    kill();

    if (code === FABRICATOR_PROTOCOL_EXIT_CODE) {
      return cb(
        fabricatorProtocolError(
          `fabricator channel desynced for file ${snap} (exit ${code})${tailSuffix()}`,
        ),
      );
    }

    if (code !== 0) {
      return cb(
        new Error(
          `Failed to make bytecode ${fabricator.nodeRange}-${fabricator.arch} for file ${snap} (exit ${code})${tailSuffix()}`,
        ),
      );
    }

    if (state.stdoutBuf.length > 0) {
      return cb(
        new Error(
          `${cmd} closed unexpectedly, output: ${toPrintableSnippet(state.stdoutBuf)}${tailSuffix()}`,
        ),
      );
    }

    return cb(new Error(`${cmd} closed unexpectedly${tailSuffix()}`));
  }

  // Tries to deliver one frame from the buffered bytes. Returns true when
  // the call settled (frame delivered or fatal protocol error).
  function tryDeliver(): boolean {
    const parsed = tryParseFabricatorResponse(state.stdoutBuf);

    if (parsed.status === 'protocol-error') {
      settled = true;
      clearTimeout(timer);
      removeListeners();
      kill();
      cb(
        fabricatorProtocolError(
          `invalid fabricator response for file ${snap}: ${parsed.message}${tailSuffix()}`,
        ),
      );
      return true;
    }

    if (parsed.status === 'ok') {
      settled = true;
      clearTimeout(timer);
      state.stdoutBuf = parsed.remainder;
      removeListeners();
      cb(undefined, parsed.frame);
      return true;
    }

    return false;
  }

  function onData(data: Buffer) {
    if (settled) {
      return;
    }

    // Responses are single small frames, so concatenating per event is
    // bounded; the timeout above guards the only unbounded wait.
    state.stdoutBuf =
      state.stdoutBuf.length === 0
        ? data
        : Buffer.concat([state.stdoutBuf, data]);
    tryDeliver();
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

  // A previous call may have left a pipelined response buffered; deliver it
  // without waiting for a new `data` event that will never come.
  if (state.stdoutBuf.length >= 4 && tryDeliver()) {
    return;
  }

  let requestChunks: Buffer[];
  try {
    requestChunks = buildFabricatorRequestChunks(snap, body);
  } catch (error) {
    settled = true;
    clearTimeout(timer);
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
    if (error) {
      // Deterministic failures (oversize payload) and desynced channels
      // fail loudly instead of being retried and/or degraded to source.
      if (
        isDeterministicFabricatorError(error) ||
        isFabricatorProtocolError(error)
      ) {
        return cb(error);
      }

      log.debug(
        `fabricator: first attempt failed for ${snap}: ${error.message}; retrying`,
      );
      return fabricate(bakes, fabricator, snap, body, cb);
    }

    cb(undefined, buffer);
  });
}

export function shutdown() {
  for (const key in children) {
    if (children[key]) {
      const state = children[key];
      delete children[key];
      state.proc.kill();
    }
  }
}
