import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';
import { log } from './log';
import { Target } from './types';

// Upper bound for one framed part (snap path, file body or cachedData).
// Frame headers are signed i32, so this stays well under 2GB. See
// docs/ARCHITECTURE.md for the framing description.
export const FABRICATOR_MAX_FRAME_PART_SIZE = 256 * 1024 * 1024;

// Exit code for framing violations (corrupt size headers). Distinct from
// exit 2 (V8 refused a well-formed request) and outside Node's reserved
// 1-14 range, so a Node bootstrap failure is never read as a desync.
export const FABRICATOR_PROTOCOL_EXIT_CODE = 65;

// A child that accepts a valid frame and then never answers must not stall
// the build forever. There is no other timeout on this path.
export const FABRICATOR_RESPONSE_TIMEOUT_MS = 60 * 1000;

// Responses go on their own pipe: V8 flags such as `--trace-gc` print to
// stdout and would otherwise corrupt the frame stream.
const FABRICATOR_RESPONSE_FD = 3;

// Bounded tail of child stderr attached to failures so non-debug users see
// the cause (e.g. `Pkg: Cached data not produced.`).
const FABRICATOR_STDERR_TAIL_MAX_BYTES = 16 * 1024;
const FABRICATOR_STDERR_TAIL_MAX_CHARS = 2000;

export const fabricatorScript = `
  var vm = require('vm');
  var module = require('module');
  var net = require('net');
  var MAX_FRAME_PART_SIZE = ${FABRICATOR_MAX_FRAME_PART_SIZE};
  var PROTOCOL_EXIT_CODE = ${FABRICATOR_PROTOCOL_EXIT_CODE};
  var out = new net.Socket({ fd: ${FABRICATOR_RESPONSE_FD}, readable: false, writable: true });
  var chunks = [];
  var chunksLength = 0;
  // Bytes needed before another parse attempt is worthwhile; keeps the
  // concat below to a few copies per frame instead of one per chunk.
  var needed = 4;
  process.stdin.on('data', function (data) {
    chunks.push(data);
    chunksLength += data.length;
    if (chunksLength < needed) return;
    var stdin = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, chunksLength);
    var offset = 0;
    for (;;) {
      var available = stdin.length - offset;
      if (available < 4) { needed = 4; break; }
      var sizeOfSnap = stdin.readInt32LE(offset);
      if (sizeOfSnap < 0 || sizeOfSnap > MAX_FRAME_PART_SIZE) {
        console.error('Pkg: Invalid snap size header: ' + sizeOfSnap);
        process.exit(PROTOCOL_EXIT_CODE);
      }
      if (available < 4 + sizeOfSnap + 4) { needed = 4 + sizeOfSnap + 4; break; }
      var sizeOfBody = stdin.readInt32LE(offset + 4 + sizeOfSnap);
      if (sizeOfBody < 0 || sizeOfBody > MAX_FRAME_PART_SIZE) {
        console.error('Pkg: Invalid body size header: ' + sizeOfBody);
        process.exit(PROTOCOL_EXIT_CODE);
      }
      var totalSize = 4 + sizeOfSnap + 4 + sizeOfBody;
      if (available < totalSize) { needed = totalSize; break; }

      var snap = stdin.toString('utf8', offset + 4, offset + 4 + sizeOfSnap);
      var body = stdin.subarray(offset + 4 + sizeOfSnap + 4, offset + totalSize);
      offset += totalSize;

      var code = module.wrap(body);
      var s = new vm.Script(code, {
        filename: snap,
        produceCachedData: true,
        sourceless: true
      });
      // Exit 2 is a per-file compile failure: the parent may ship source.
      if (!s.cachedDataProduced) {
        console.error('Pkg: Cached data not produced.');
        process.exit(2);
      }
      var b = s.cachedData;
      if (b.length > MAX_FRAME_PART_SIZE) {
        console.error('Pkg: Cached data exceeds max frame size: ' + b.length);
        process.exit(2);
      }
      var h = Buffer.alloc(4);
      h.writeInt32LE(b.length, 0);
      out.write(h);
      out.write(b);
    }
    // Copy the partial tail so it never pins the consumed frames' memory.
    var rest = stdin.subarray(offset);
    chunks = rest.length === 0 ? [] : [Buffer.from(rest)];
    chunksLength = rest.length;
  });
  process.stdin.resume();
`;

export type FabricatorFrameParseResult =
  | { status: 'ok'; frame: Buffer; remainder: Buffer }
  | { status: 'incomplete'; needed: number }
  | { status: 'protocol-error'; message: string };

// Response side of the frame protocol: validate the header against the
// shared max and slice one frame. The child script keeps its own inline
// request parser since it must stay self-contained `-e` source text.
export function tryParseFabricatorResponse(
  buffer: Buffer,
): FabricatorFrameParseResult {
  if (buffer.length < 4) {
    return { status: 'incomplete', needed: 4 };
  }

  const sizeOfBlob = buffer.readInt32LE(0);

  if (sizeOfBlob < 0 || sizeOfBlob > FABRICATOR_MAX_FRAME_PART_SIZE) {
    return {
      status: 'protocol-error',
      message: `Invalid blob size header: ${sizeOfBlob}`,
    };
  }

  if (buffer.length < 4 + sizeOfBlob) {
    return { status: 'incomplete', needed: 4 + sizeOfBlob };
  }

  return {
    status: 'ok',
    frame: buffer.subarray(4, 4 + sizeOfBlob),
    remainder: buffer.subarray(4 + sizeOfBlob),
  };
}

// Failures that must not be retried: an oversize payload fails the same
// way twice, a timeout would just double the wait, and a desynced channel
// aborts the build.
export type FabricatorErrorCode =
  | 'FABRICATOR_FRAME_TOO_LARGE'
  | 'FABRICATOR_TIMEOUT'
  | 'FABRICATOR_PROTOCOL';

export function fabricatorError(
  code: FabricatorErrorCode,
  message: string,
): Error {
  const error = new Error(message);
  (error as NodeJS.ErrnoException).code = code;
  return error;
}

export function fabricatorErrorCode(
  error?: Error | null,
): FabricatorErrorCode | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'FABRICATOR_FRAME_TOO_LARGE' ||
    code === 'FABRICATOR_TIMEOUT' ||
    code === 'FABRICATOR_PROTOCOL'
    ? code
    : undefined;
}

export function checkFabricatorFramePartSize(
  label: 'snap' | 'body',
  byteLength: number,
): void {
  if (byteLength > FABRICATOR_MAX_FRAME_PART_SIZE) {
    throw fabricatorError(
      'FABRICATOR_FRAME_TOO_LARGE',
      `Fabricator ${label} exceeds max frame size (${byteLength} bytes)`,
    );
  }
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

interface FabricatorRequest {
  snap: string;
  cb: (error?: Error, buffer?: Buffer) => void;
  timer: NodeJS.Timeout;
}

interface FabricatorChild {
  key: string;
  label: string;
  proc: ChildProcess;
  chunks: Buffer[];
  chunksLength: number;
  needed: number;
  stderrTail: Buffer[];
  stderrTailLength: number;
  // The child answers one request at a time; output with no pending
  // request means the channel is desynced.
  pending?: FabricatorRequest;
}

const children: Record<string, FabricatorChild> = {};

function appendStderrTail(state: FabricatorChild, data: Buffer) {
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

function tailSuffix(state: FabricatorChild): string {
  const tail = Buffer.concat(state.stderrTail)
    .toString('utf8')
    .trim()
    .slice(-FABRICATOR_STDERR_TAIL_MAX_CHARS);
  return tail ? ` stderr: ${tail}` : '';
}

function settle(state: FabricatorChild, error?: Error, frame?: Buffer) {
  const request = state.pending;

  if (!request) {
    return;
  }

  state.pending = undefined;
  clearTimeout(request.timer);
  request.cb(error, frame);
}

function evict(state: FabricatorChild) {
  if (children[state.key] === state) {
    delete children[state.key];
  }
}

function kill(state: FabricatorChild) {
  evict(state);
  // SIGKILL: a child stuck in a synchronous compile ignores SIGTERM.
  state.proc.kill('SIGKILL');
}

function fail(state: FabricatorChild, error: Error) {
  kill(state);

  if (!state.pending) {
    log.warn(`${error.message}. Restarting the fabricator.`);
  }

  settle(state, error);
}

function failProtocol(state: FabricatorChild, message: string) {
  const snap = state.pending?.snap;
  fail(
    state,
    fabricatorError(
      'FABRICATOR_PROTOCOL',
      `Fabricator ${state.label} channel desynced${snap ? ` for file ${snap}` : ''}: ${message}${tailSuffix(state)}`,
    ),
  );
}

function onResponseData(state: FabricatorChild, data: Buffer) {
  if (!state.pending) {
    return failProtocol(
      state,
      `${data.length} bytes received with no request pending`,
    );
  }

  state.chunks.push(data);
  state.chunksLength += data.length;

  if (state.chunksLength < state.needed) {
    return;
  }

  const buffer =
    state.chunks.length === 1
      ? state.chunks[0]
      : Buffer.concat(state.chunks, state.chunksLength);
  const parsed = tryParseFabricatorResponse(buffer);

  if (parsed.status === 'incomplete') {
    state.chunks = [buffer];
    state.needed = parsed.needed;
    return;
  }

  state.chunks = [];
  state.chunksLength = 0;
  state.needed = 4;

  if (parsed.status === 'protocol-error') {
    return failProtocol(state, parsed.message);
  }

  if (parsed.remainder.length > 0) {
    return failProtocol(
      state,
      `${parsed.remainder.length} unexpected bytes after response`,
    );
  }

  settle(state, undefined, parsed.frame);
}

function spawnFabricator(
  key: string,
  label: string,
  cmd: string,
  activeBakes: string[],
): FabricatorChild {
  const proc = spawn(cmd, activeBakes.concat('-e', fabricatorScript), {
    stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
    env: { PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
  });
  const state: FabricatorChild = {
    key,
    label,
    proc,
    chunks: [],
    chunksLength: 0,
    needed: 4,
    stderrTail: [],
    stderrTailLength: 0,
  };
  const response = proc.stdio[FABRICATOR_RESPONSE_FD] as Readable;

  function onError(error: Error) {
    fail(
      state,
      new Error(
        `Failed to make bytecode ${label} for file ${state.pending?.snap} error (${error.message})${tailSuffix(state)}`,
      ),
    );
  }

  proc.on('error', onError);
  proc.stdin?.on('error', onError);
  response.on('error', onError);
  response.on('data', (data: Buffer) => onResponseData(state, data));

  proc.stderr?.on('data', (data: Buffer) => {
    appendStderrTail(state, data);

    if (log.debugMode) {
      log.debug(`fabricator: ${data.toString().trim()}`);
    }
  });

  // Evict on any exit, requested or not, so the next call respawns
  // instead of writing into a dead pipe.
  proc.on('close', (code, signal) => {
    evict(state);

    const snap = state.pending?.snap;

    if (code === FABRICATOR_PROTOCOL_EXIT_CODE) {
      return failProtocol(
        state,
        `child rejected a malformed request (exit ${code})`,
      );
    }

    settle(
      state,
      new Error(
        code === 0
          ? `${cmd} closed unexpectedly for file ${snap}${tailSuffix(state)}`
          : `Failed to make bytecode ${label} for file ${snap} (exit ${code ?? signal})${tailSuffix(state)}`,
      ),
    );
  });

  return state;
}

export function fabricate(
  bakes: string[],
  fabricator: Target,
  snap: string,
  body: Buffer,
  cb: (error?: Error, buffer?: Buffer) => void,
  timeoutMs: number = FABRICATOR_RESPONSE_TIMEOUT_MS,
) {
  let requestChunks: Buffer[];
  try {
    requestChunks = buildFabricatorRequestChunks(snap, body);
  } catch (error) {
    return cb(error as Error);
  }

  const activeBakes = bakes.filter((bake) => {
    // list of bakes that don't influence the bytecode
    const bake2 = bake.replace(/_/g, '-');

    return !['--prof', '--v8-options', '--trace-opt', '--trace-deopt'].includes(
      bake2,
    );
  });

  const cmd = fabricator.binaryPath;
  const key = JSON.stringify([cmd, activeBakes]);
  const label = `${fabricator.nodeRange}-${fabricator.arch}`;

  if (!children[key]) {
    children[key] = spawnFabricator(key, label, cmd, activeBakes);
  }

  const state = children[key];

  // Only this request's stderr belongs in its failure message.
  state.stderrTail = [];
  state.stderrTailLength = 0;

  const timer = setTimeout(() => {
    kill(state);
    settle(
      state,
      fabricatorError(
        'FABRICATOR_TIMEOUT',
        `Timed out after ${timeoutMs}ms waiting for bytecode ${label} for file ${snap}${tailSuffix(state)}`,
      ),
    );
  }, timeoutMs);

  state.pending = { snap, cb, timer };

  for (const chunk of requestChunks) {
    state.proc.stdin?.write(chunk);
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
      if (fabricatorErrorCode(error)) {
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
