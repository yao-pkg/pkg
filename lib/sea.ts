import { execFile as cExecFile } from 'child_process';
import util from 'util';
import { basename, dirname, join, resolve } from 'path';
import {
  copyFile,
  writeFile,
  rm,
  mkdir,
  mkdtemp,
  stat,
  readFile,
} from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { ReadableStream } from 'stream/web';
import { createHash } from 'crypto';
import { homedir, tmpdir } from 'os';
import unzipper from 'unzipper';
import { extract as tarExtract } from 'tar';
import { log, wasReported } from './log';
import {
  NodeTarget,
  Target,
  SeaEnhancedOptions,
  NodeVersion,
  NodeRange,
  NodeOs,
  NodeArch,
  NODE_OSES,
  NODE_ARCHS,
} from './types';
import { patchMachOExecutable, signMachOExecutable } from './mach-o';
import walk from './walker';
import refine from './refiner';
import { generateSeaAssets } from './sea-assets';
import { runPostBuild, runTransform } from './hooks';
import pkgOptions from './options';
import { inject as postjectInject } from 'postject';
import { system } from '@yao-pkg/pkg-fetch';

const { hostPlatform, hostArch } = system;

const execFileAsync = util.promisify(cExecFile);

/**
 * The SEA fuse sentinel that postject uses to activate the binary.
 *
 * Built by concatenation so the literal never appears as a single string
 * in compiled output.  When pkg's own code is walked into a SEA archive
 * (e.g. user lists @yao-pkg/pkg in dependencies), a verbatim sentinel
 * would end up inside the injected blob, causing postject to find
 * duplicate occurrences and fail with "Multiple occurences of sentinel".
 */
// prettier-ignore
const SEA_SENTINEL_FUSE =
  'NODE_SEA' + '_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/** Returns stat of path when exits, false otherwise */
const exists = async (path: string) => {
  try {
    return await stat(path);
  } catch {
    return false;
  }
};

/**
 * Benign LIEF messages printed by postject during SEA blob injection.
 *
 * LIEF re-parses the Node binary after postject expands the section
 * table to make room for `NODE_SEA_BLOB`, and the pre-existing
 * build-id / `.note.*` section-name offsets no longer resolve cleanly
 * through `.shstrtab` — so LIEF falls back to synthetic names like
 * `.note.100` and warns. On Mach-O the analogous "signature seems
 * corrupted" line is also cosmetic: we re-sign the binary with
 * `codesign` after injection (see signMachOExecutable).
 *
 * The warnings have no bearing on correctness of the produced
 * executable but users reasonably assume something is wrong, so we
 * filter them out of stderr just for the duration of the inject call.
 */
const BENIGN_POSTJECT_STDERR =
  /^warning: (?:The signature seems corrupted!|Can't find string offset for section name '\.note)/;

type StderrWrite = typeof process.stderr.write;
type WriteCallback = (err?: Error | null) => void;

/**
 * Run `fn` with `process.stderr.write` wrapped to drop known-benign
 * postject/LIEF messages. Anything that doesn't match the allow-list
 * pattern passes through unchanged, so real errors are never hidden.
 * The original `write` is restored in a `finally` block regardless of
 * whether `fn` resolves or rejects.
 */
async function withFilteredPostjectStderr<T>(fn: () => Promise<T>): Promise<T> {
  const original: StderrWrite = process.stderr.write;
  const bound: StderrWrite = original.bind(process.stderr);
  const filtered = ((
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | WriteCallback,
    cb?: WriteCallback,
  ): boolean => {
    const text =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : Buffer.from(chunk).toString('utf8');
    if (BENIGN_POSTJECT_STDERR.test(text)) {
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      if (callback) process.nextTick(callback);
      return true;
    }
    // The write() overloads accept either an encoding or a callback in
    // slot 2; disambiguate here so the correct overload is dispatched.
    return typeof encodingOrCb === 'function'
      ? bound(chunk, encodingOrCb)
      : bound(chunk, encodingOrCb, cb);
  }) as StderrWrite;
  process.stderr.write = filtered;
  try {
    return await fn();
  } finally {
    process.stderr.write = original;
  }
}

export type GetNodejsExecutableOptions = {
  useLocalNode?: boolean;
  nodePath?: string;
};

export type SeaConfig = {
  disableExperimentalSEAWarning: boolean;
  useSnapshot: boolean; // must be set to false when cross-compiling
  useCodeCache: boolean; // must be set to false when cross-compiling
  // TODO: add support for assets: https://nodejs.org/api/single-executable-applications.html#single_executable_applications_assets
  assets?: Record<string, string>;
};

export type SeaOptions = {
  seaConfig?: SeaConfig;
  signature?: boolean;
  targets: (NodeTarget & Partial<Target>)[];
} & GetNodejsExecutableOptions;

const defaultSeaConfig: SeaConfig = {
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
};

/** Download a file from a given URL and save it to `filePath` */
async function downloadFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download file from ${url}`);
  }

  const fileStream = createWriteStream(filePath);
  return pipeline(response.body as unknown as ReadableStream, fileStream);
}

/** Extract node executable from the archive */
async function extract(os: NodeOs, archivePath: string): Promise<string> {
  const nodeDir = basename(archivePath, os === 'win' ? '.zip' : '.tar.gz');
  const archiveDir = dirname(archivePath);
  const nodePath =
    os === 'win'
      ? join(archiveDir, `${nodeDir}.exe`)
      : join(archiveDir, nodeDir, 'bin', 'node');

  // Skip extraction when a sentinel marks the previous extract as complete.
  // Both tar and unzipper write to the final path directly, so a crash
  // mid-extract would otherwise leave a truncated binary that silently
  // poisons future runs. The sentinel is only written after extraction
  // succeeds, so its absence forces a re-extract. We also require the
  // binary itself to be present — if a user or cleanup tool removed the
  // extracted binary, returning a stale `nodePath` would surface as a
  // confusing ENOENT at bake() time.
  const sentinel = `${nodePath}.ok`;
  if ((await exists(sentinel)) && (await exists(nodePath))) {
    return nodePath;
  }

  // Clear any partial output or stale sentinel from a previously
  // interrupted extract or out-of-band cache cleanup.
  await rm(nodePath, { force: true });
  await rm(sentinel, { force: true });

  if (os === 'win') {
    const { files } = await unzipper.Open.file(archivePath);
    const nodeBinPath = `${nodeDir}/node.exe`;
    const nodeBin = files.find((file) => file.path === nodeBinPath);

    if (!nodeBin) {
      throw new Error('Node executable not found in the archive');
    }

    await pipeline(nodeBin.stream(), createWriteStream(nodePath));
  } else {
    await tarExtract({
      file: archivePath,
      cwd: archiveDir,
      filter: (path) => path === `${nodeDir}/bin/node`,
    });
  }

  if (!(await exists(nodePath))) {
    throw new Error('Node executable not found in the archive');
  }

  await writeFile(sentinel, '');
  return nodePath;
}

/** Verify the checksum of downloaded NodeJS archive */
async function verifyChecksum(
  filePath: string,
  checksumUrl: string,
  fileName: string,
): Promise<void> {
  const response = await fetch(checksumUrl);
  if (!response.ok) {
    throw new Error(`Failed to download checksum file from ${checksumUrl}`);
  }

  const checksums = await response.text();
  const expectedChecksum = checksums
    .split('\n')
    .find((line) => line.includes(fileName))
    ?.split(' ')[0];

  if (!expectedChecksum) {
    throw new Error(`Checksum for ${fileName} not found`);
  }

  const fileBuffer = await readFile(filePath);
  const hashSum = createHash('sha256');
  hashSum.update(fileBuffer);

  const actualChecksum = hashSum.digest('hex');
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Checksum verification failed for ${fileName}`);
  }
}

/** Get the node os based on target platform */
function getNodeOs(platform: string): NodeOs {
  const platformsMap: Record<string, string> = {
    macos: 'darwin',
  };

  const validatedPlatform = platformsMap[platform] || platform;

  if (!(NODE_OSES as readonly string[]).includes(validatedPlatform)) {
    throw new Error(`Unsupported OS: ${platform}`);
  }

  return validatedPlatform as NodeOs;
}

/** Get the node arch based on target arch */
function getNodeArch(arch: string): NodeArch {
  if (!(NODE_ARCHS as readonly string[]).includes(arch)) {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  return arch as NodeArch;
}

/**
 * Get latest Node.js version covering a partial range. Accepts `22`,
 * `22.22`, or `22.22.2`; returns the canonical v-prefixed triple the
 * rest of the file expects.
 */
async function getNodeVersion(
  os: NodeOs,
  arch: NodeArch,
  nodeVersion: string,
): Promise<NodeVersion> {
  // validate nodeVersion using regex. Allowed formats: 16, 16.0, 16.0.0
  const regex = /^\d{1,2}(\.\d{1,2}){0,2}$/;
  if (!regex.test(nodeVersion)) {
    throw new Error('Invalid node version format');
  }

  const parts = nodeVersion.split('.');

  if (parts.length > 3) {
    throw new Error('Invalid node version format');
  }

  if (parts.length === 3) {
    return `v${nodeVersion}` as NodeVersion;
  }

  let url;
  switch (arch) {
    case 'riscv64':
    case 'loong64':
      url = 'https://unofficial-builds.nodejs.org/download/release/index.json';
      break;
    default:
      url = 'https://nodejs.org/dist/index.json';
      break;
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch node versions');
  }

  const versions = (await response.json()) as {
    version: string;
    files: string[];
  }[];

  const nodeOS = os === 'darwin' ? 'osx' : os;
  const latest = versions.find(
    (v) =>
      v.version.startsWith(`v${nodeVersion}`) &&
      v.files.some((f) => f.startsWith(`${nodeOS}-${arch}`)),
  );

  if (!latest) {
    throw new Error(`Node version ${nodeVersion} not found`);
  }

  return latest.version as NodeVersion;
}

/**
 * Resolve the concrete Node.js version (e.g. `v22.22.2`) pkg will use
 * for `target` — mirrors the version selection done inside
 * {@link getNodejsExecutable} without performing the download, so
 * callers can reason about host/target version skew independently of
 * the download itself.
 */
async function resolveTargetNodeVersion(
  target: NodeTarget,
  opts: GetNodejsExecutableOptions,
): Promise<NodeVersion> {
  if (opts.useLocalNode) return process.version as NodeVersion;
  if (opts.nodePath) {
    // A user-supplied binary can be any version — don't assume it
    // matches the host. Ask it directly.
    const { stdout } = await execFileAsync(opts.nodePath, ['--version']);
    return stdout.trim() as NodeVersion;
  }
  const os = getNodeOs(target.platform);
  const arch = getNodeArch(target.arch);
  return getNodeVersion(os, arch, target.nodeRange.replace('node', ''));
}

/** Fetch, validate and extract nodejs binary. Returns a path to it */
async function getNodejsExecutable(
  target: NodeTarget,
  opts: GetNodejsExecutableOptions,
): Promise<string> {
  if (opts.nodePath) {
    // check if the nodePath exists
    if (!(await exists(opts.nodePath))) {
      throw new Error(
        `Priovided node executable path "${opts.nodePath}" does not exist`,
      );
    }

    return opts.nodePath;
  }

  if (opts.useLocalNode) {
    return process.execPath;
  }

  const os = getNodeOs(target.platform);
  const arch = getNodeArch(target.arch);

  const nodeVersion = await resolveTargetNodeVersion(target, opts);

  const fileName = `node-${nodeVersion}-${os}-${arch}.${os === 'win' ? 'zip' : 'tar.gz'}`;

  let url;
  let checksumUrl;
  switch (arch) {
    case 'riscv64':
    case 'loong64':
      url = `https://unofficial-builds.nodejs.org/download/release/${nodeVersion}/${fileName}`;
      checksumUrl = `https://unofficial-builds.nodejs.org/download/release/${nodeVersion}/SHASUMS256.txt`;
      break;
    default:
      url = `https://nodejs.org/dist/${nodeVersion}/${fileName}`;
      checksumUrl = `https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`;
      break;
  }

  const downloadDir = join(homedir(), '.pkg-cache', 'sea');

  // Ensure the download directory exists
  if (!(await exists(downloadDir))) {
    await mkdir(downloadDir, { recursive: true });
  }

  const filePath = join(downloadDir, fileName);
  const archiveSentinel = `${filePath}.ok`;

  // Skip download + checksum only when a sentinel marks the previous run as
  // verified. downloadFile writes straight to filePath without tmp+rename,
  // so an interrupted download would otherwise leave a partial archive that
  // later skips checksum verification and fails cryptically at extract time.
  if (!((await exists(archiveSentinel)) && (await exists(filePath)))) {
    // Clear any partial download or stale sentinel.
    await rm(filePath, { force: true });
    await rm(archiveSentinel, { force: true });

    log.info(`Downloading nodejs executable from ${url}...`);
    await downloadFile(url, filePath);
    log.info(`Verifying checksum of ${fileName}`);
    await verifyChecksum(filePath, checksumUrl, fileName);

    await writeFile(archiveSentinel, '');
  }

  log.info(`Extracting node binary from ${fileName}`);
  const nodePath = await extract(os, filePath);

  return nodePath;
}

/** Bake the blob into the executable */
async function bake(
  nodePath: string,
  target: NodeTarget & Partial<Target>,
  blobData: Buffer,
): Promise<void> {
  const outPath = resolve(process.cwd(), target.output as string);

  log.info(
    `Creating executable for ${target.nodeRange}-${target.platform}-${target.arch}....`,
  );

  if (!(await exists(dirname(outPath)))) {
    await mkdir(dirname(outPath), { recursive: true });
  }
  // check if executable_path exists
  if (await exists(outPath)) {
    log.warn(`Executable ${outPath} already exists, will be overwritten`);
  }

  // copy the executable as the output executable
  await copyFile(nodePath, outPath);

  log.info(`Injecting the blob into ${outPath}...`);
  // No pre-strip of the downloaded node binary's signature on macOS:
  // the final `codesign -f --sign -` in signMacOSIfNeeded force-replaces
  // any existing signature after postject injection, so a preliminary
  // `codesign --remove-signature` is redundant.

  // Use postject JS API directly instead of spawning npx.
  // This avoids two CI issues:
  // 1. "Text file busy" race condition from concurrent npx invocations
  // 2. "Argument is not a constructor" from npx downloading incompatible versions
  await withFilteredPostjectStderr(() =>
    postjectInject(outPath, 'NODE_SEA_BLOB', blobData, {
      sentinelFuse: SEA_SENTINEL_FUSE,
      machoSegmentName: target.platform === 'macos' ? 'NODE_SEA' : undefined,
      overwrite: true,
    }),
  );
}

/**
 * Patch mach-O __LINKEDIT (non-SEA only) and ad-hoc sign the binary.
 *
 * The __LINKEDIT patch exists for the classic pkg flow: pkg appends the
 * VFS payload to the end of the binary, and codesign only hashes content
 * covered by __LINKEDIT — so the segment must be extended to include the
 * payload before signing.
 *
 * Pass `isSea: true` to skip the patch. For SEA binaries postject
 * already creates a dedicated NODE_SEA `LC_SEGMENT_64` (per the
 * [Node.js SEA docs](https://nodejs.org/api/single-executable-applications.html))
 * and __LINKEDIT already sits at the file tail with
 * `filesize = file.length - fileoff`, so the patch is a no-op on the
 * resulting Mach-O. The docs call for just `codesign --sign -` after
 * postject, which is what `signMachOExecutable` does.
 */
export async function signMacOSIfNeeded(
  output: string,
  target: NodeTarget & Partial<Target>,
  signature?: boolean,
  isSea?: boolean,
): Promise<void> {
  if (!signature || target.platform !== 'macos') return;

  if (!isSea) {
    const buf = patchMachOExecutable(await readFile(output));
    await writeFile(output, buf);
  }

  try {
    signMachOExecutable(output);
  } catch {
    if (target.arch === 'arm64') {
      log.warn('Unable to sign the macOS executable', [
        'Due to the mandatory code signing requirement, before the',
        'executable is distributed to end users, it must be signed.',
        'Otherwise, it will be immediately killed by kernel on launch.',
        'An ad-hoc signature is sufficient.',
        'To do that, run pkg on a Mac, or transfer the executable to a Mac',
        'and run "codesign --sign - <executable>", or (if you use Linux)',
        'install "ldid" utility to PATH and then run pkg again',
      ]);
    }
  }
}

/** Run a callback inside a temporary directory, cleaning up afterwards */
async function withSeaTmpDir<T>(
  fn: (tmpDir: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'pkg-sea-'));
  const previousDirectory = process.cwd();
  try {
    process.chdir(tmpDir);
    return await fn(tmpDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(
      `Error while creating the executable: ${message}`,
      { cause: error },
    );
    // Preserve the original stack if available
    if (error instanceof Error && error.stack) {
      wrapped.stack = `${wrapped.message}\n  [cause]: ${error.stack}`;
    }
    throw wrapped;
  } finally {
    process.chdir(previousDirectory);
    await rm(tmpDir, { recursive: true }).catch(() => {
      log.warn(`Failed to cleanup the temp directory ${tmpDir}`);
    });
  }
}

/**
 * Validate that the host Node.js version running pkg supports SEA.
 * Although node:sea is stable from Node 20, pkg requires 22+ to align with
 * engines.node and the @roberts_lando/vfs dependency.
 *
 * Host-only check — target Node majors are validated via
 * {@link resolveMinTargetMajor}.
 */
function assertHostSeaNodeVersion(): number {
  const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
  if (nodeMajor < 22) {
    throw new Error(
      `SEA support requires at least node v22.0.0, actual node version is ${process.version}`,
    );
  }
  return nodeMajor;
}

/**
 * Resolve the smallest target Node.js major version across a target list.
 * Unparseable ranges (e.g. "latest") fall back to the host major so pkg on
 * Node 25 treats "latest" as 25.
 */
function resolveMinTargetMajor(
  targets: (NodeTarget & Partial<Target>)[],
): number {
  const hostMajor = parseInt(process.version.slice(1), 10);
  if (targets.length === 0) return hostMajor;
  return Math.min(
    ...targets.map((t) => {
      const v = parseInt(t.nodeRange.replace('node', ''), 10);
      return Number.isNaN(v) ? hostMajor : v;
    }),
  );
}

/**
 * SEA prep blobs are Node-major specific (e.g. Node 25.8 added an
 * exec_argv_extension header field), so a single blob cannot be safely
 * baked into binaries of different Node majors. Reject mixed-major target
 * lists up front instead of silently producing broken executables.
 */
function assertSingleTargetMajor(
  targets: (NodeTarget & Partial<Target>)[],
): void {
  const hostMajor = parseInt(process.version.slice(1), 10);
  const majors = new Set(
    targets.map((t) => {
      const v = parseInt(t.nodeRange.replace('node', ''), 10);
      return Number.isNaN(v) ? hostMajor : v;
    }),
  );
  if (majors.size > 1) {
    throw wasReported(
      `SEA mode cannot mix Node.js majors in a single run ` +
        `(got ${[...majors].sort((a, b) => a - b).join(', ')}). ` +
        `Run pkg once per Node major.`,
    );
  }
}

/**
 * Index into `targets` of the first entry whose platform+arch match
 * `host`, or -1 when no target is runnable on the host. Exported for
 * unit testing step 1 of the SEA blob-generator selection without
 * spinning up a full pkg invocation.
 */
export function pickMatchingHostTargetIndex(
  host: { platform: string; arch: string },
  targets: readonly { platform: string; arch: string }[],
): number {
  return targets.findIndex(
    (t) => t.platform === host.platform && t.arch === host.arch,
  );
}

/**
 * Pick the node binary used to generate the SEA prep blob.
 *
 * The blob layout is node-version specific — not just major-version
 * specific.  Node occasionally changes the SEA header layout within a
 * single major line (Node 22.19/22.20 added fields that break the 22.22
 * reader, Node 25.8 added `exec_argv_extension`, etc.), so using a host
 * Node whose patch release differs from the downloaded target binary
 * crashes `node::sea::FindSingleExecutableResource` at startup with
 * `EXC_BAD_ACCESS` inside `BlobDeserializer::ReadArithmetic` — see
 * discussion #236.
 *
 * Strategy (all paths guarantee the generator is the same version as the
 * reader, eliminating patch-version skew):
 *
 *   1. Prefer a downloaded target binary whose platform & arch match the
 *      host — already downloaded, guaranteed version-matched.
 *   2. Otherwise (pure cross-platform build, e.g. Linux host producing
 *      only a macos-arm64 binary), download a host-platform/arch node
 *      binary at the same node range as the targets and use it purely
 *      as the generator.
 *   3. If the host-platform download fails (unsupported host such as
 *      alpine/musl, offline, checksum mismatch, …), fall back to
 *      `process.execPath` only when its version exactly matches the
 *      resolved target version. Otherwise hard-fail — silently running
 *      the generator with a skewed node would reintroduce the same
 *      EXC_BAD_ACCESS this function exists to prevent.
 *
 * All targets share a single node major (enforced by
 * {@link assertSingleTargetMajor}).
 */
async function pickBlobGeneratorBinary(
  targets: (NodeTarget & Partial<Target>)[],
  nodePaths: string[],
  opts: GetNodejsExecutableOptions,
): Promise<string> {
  const matchIdx = pickMatchingHostTargetIndex(
    { platform: hostPlatform, arch: hostArch },
    targets,
  );
  if (matchIdx !== -1) {
    log.debug(
      `SEA blob generator: host matches ${targets[matchIdx].platform}-${targets[matchIdx].arch} target, reusing its downloaded binary (${nodePaths[matchIdx]}).`,
    );
    return nodePaths[matchIdx];
  }

  // No target is runnable on the host. Resolve the target's concrete
  // patch version first, then pin a host-platform download to that exact
  // version so the blob generator and the SEA reader baked into each
  // target share the same patch level — otherwise we regress into the
  // discussion #236 crash on any host/target patch skew. Resolving
  // against target's platform/arch (not host's) is what pins the
  // version: host and target could otherwise land on different latest
  // patches (unofficial builds, arch-specific availability).
  const targetVersion = await resolveTargetNodeVersion(targets[0], opts);

  if (targetVersion === process.version) {
    // Host already runs the exact target version; no download needed.
    return process.execPath;
  }

  log.info(
    `No target matches host ${hostPlatform}-${hostArch}; downloading a ` +
      `host-platform node ${targetVersion} to generate the SEA blob ` +
      `(avoids SEA header version skew — see discussion #236).`,
  );
  try {
    // nodeRange must be `node<bare>` so
    // getNodejsExecutable → getNodeVersion's `replace('node','')` + regex
    // sees a clean `22.22.2` (v-prefix would fail the validator).
    // `hostPlatform` from pkg-fetch is wider than NodeTarget.platform
    // (e.g. 'alpine', 'linuxstatic'); getNodejsExecutable only reads
    // platform/arch to route the download, so the assertion is safe.
    const nodeRange: NodeRange = `node${targetVersion.slice(1)}`;
    const hostGeneratorTarget = {
      platform: hostPlatform,
      arch: hostArch,
      nodeRange,
    } as NodeTarget;
    // Drop user-supplied nodePath / useLocalNode: they'd short-circuit
    // the download in getNodejsExecutable and reintroduce version skew.
    const downloadOpts: GetNodejsExecutableOptions = {
      ...opts,
      nodePath: undefined,
      useLocalNode: false,
    };
    return await getNodejsExecutable(hostGeneratorTarget, downloadOpts);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw wasReported(
      `Cannot generate SEA blob: host node ${process.version} differs ` +
        `from target ${targetVersion} and the host-platform download ` +
        `failed (${reason}). Running the generator with a skewed node ` +
        `would crash the final binary at startup with EXC_BAD_ACCESS in ` +
        `node::sea::FindSingleExecutableResource (see discussion #236). ` +
        `Install node ${targetVersion} locally (e.g. via nvm) or pass ` +
        `nodePath pointing to a host-runnable node binary of that version.`,
    );
  }
}

/**
 * Generate the SEA prep blob from a sea-config.json file.
 *
 * Uses --experimental-sea-config (not --build-sea): --build-sea produces
 * a finished executable and bypasses the prep-blob + postject flow that
 * pkg relies on for multi-target support and for injecting custom
 * bootstraps into downloaded node binaries.
 */
async function generateSeaBlob(
  seaConfigFilePath: string,
  generatorBinary: string,
): Promise<void> {
  log.info('Generating the blob...');
  await execFileAsync(generatorBinary, [
    '--experimental-sea-config',
    seaConfigFilePath,
  ]);
}

/** Create NodeJS executable using the enhanced SEA pipeline (walker + refiner + assets) */
export async function seaEnhanced(
  entryPoint: string,
  opts: SeaEnhancedOptions,
) {
  assertHostSeaNodeVersion();

  // useSnapshot is incompatible with the enhanced VFS bootstrap: SEA's
  // snapshot mode runs the main script at build time inside a V8 startup
  // snapshot context and expects the runtime entry to be registered via
  // v8.startupSnapshot.setDeserializeMainFunction(). Our bootstrap doesn't
  // do that, and at build time `sea.getRawAsset('__pkg_archive__')` does
  // not exist yet (we're running plain Node to generate the blob, not
  // inside a SEA binary), so snapshot construction would fail outright.
  //
  // useCodeCache, on the other hand, only caches V8 bytecode for the
  // bootstrap script — it speeds up bootstrap parsing without affecting
  // the runtime VFS path. It is forwarded to sea-config below.
  if (opts.seaConfig?.useSnapshot === true) {
    throw wasReported(
      'Enhanced SEA mode does not support useSnapshot. ' +
        'Remove it from seaConfig, or use simple --sea without a package.json.',
    );
  }

  assertSingleTargetMajor(opts.targets);

  const minTargetMajor = resolveMinTargetMajor(opts.targets);
  if (minTargetMajor < 22) {
    throw wasReported(
      `Enhanced SEA mode requires Node >= 22 targets. ` +
        `Minimum target version resolved to Node ${minTargetMajor}.`,
    );
  }

  entryPoint = resolve(process.cwd(), entryPoint);

  if (!(await exists(entryPoint))) {
    throw new Error(`Entrypoint path "${entryPoint}" does not exist`);
  }

  const { marker, params = {} } = opts;

  // Run walker in SEA mode
  log.info('Walking dependencies...');
  const walkResult = await walk(marker, entryPoint, opts.addition, {
    ...params,
    seaMode: true,
  });

  // Refine (path compression, empty dir pruning)
  log.info('Refining file records...');
  const {
    records,
    entrypoint: refinedEntry,
    symLinks,
  } = refine(walkResult.records, walkResult.entrypoint, walkResult.symLinks);

  // Apply user transform hook before assets are generated, so any
  // minification/obfuscation flows into the SEA archive bytes.
  await runTransform(pkgOptions.get(), records);

  // Resolve target outputs to absolute paths before chdir to tmpDir
  for (const target of opts.targets) {
    if (target.output) {
      target.output = resolve(process.cwd(), target.output);
    }
  }

  const nodePaths = await Promise.all(
    opts.targets.map((target) => getNodejsExecutable(target, opts)),
  );

  await withSeaTmpDir(async (tmpDir) => {
    // Generate SEA assets from walker output
    log.info('Generating SEA assets...');
    const { assets, manifestPath } = await generateSeaAssets(
      records,
      refinedEntry,
      symLinks,
      tmpDir,
      { debug: log.debugMode, doCompress: opts.doCompress },
    );

    // Always use the CJS bootstrap. Native ESM SEA main
    // (sea-config mainFormat:"module", Node 25.7+ / nodejs/node#61813)
    // cannot dynamically import the user entry on Node 25.5+ because
    // the embedder dynamic-import callback only resolves builtin
    // modules (see nodejs/node#62726). The CJS bootstrap handles ESM
    // entries with top-level await by dispatching through a vm.Script
    // compiled with USE_MAIN_CONTEXT_DEFAULT_LOADER, which is routed
    // to the default ESM loader.
    const bootstrapPath = join(tmpDir, 'sea-main.js');
    await copyFile(
      join(__dirname, '..', 'prelude', 'sea-bootstrap.bundle.js'),
      bootstrapPath,
    );

    // Build sea-config.json.
    //
    // useCodeCache is forwarded from the user's seaConfig (defaulting to
    // false to match upstream Node defaults). It only affects bootstrap
    // parse speed — the runtime VFS path is unaffected.
    //
    // useSnapshot is hard-forced to false: it is incompatible with the
    // enhanced VFS bootstrap (see guard above) and an explicit `true`
    // already throws earlier — this is just a defensive default.
    const blobPath = join(tmpDir, 'sea-prep.blob');
    const seaConfig: Record<string, unknown> = {
      main: bootstrapPath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useCodeCache: opts.seaConfig?.useCodeCache ?? false,
      useSnapshot: false,
      assets: {
        __pkg_manifest__: manifestPath,
        ...assets,
      },
    };

    const seaConfigFilePath = join(tmpDir, 'sea-config.json');
    log.info('Creating sea-config.json file...');
    await writeFile(seaConfigFilePath, JSON.stringify(seaConfig));

    await generateSeaBlob(
      seaConfigFilePath,
      await pickBlobGeneratorBinary(opts.targets, nodePaths, opts),
    );

    // Read the blob once and share the buffer across all targets — avoids
    // N redundant disk reads and N peak buffer copies on multi-target builds.
    const blobData = await readFile(blobPath);

    // Bake blob into each target executable
    await Promise.all(
      nodePaths.map(async (nodePath, i) => {
        const target = opts.targets[i];
        await bake(nodePath, target, blobData);
        await signMacOSIfNeeded(target.output!, target, opts.signature, true);
      }),
    );
  });

  // postBuild runs once per produced binary, after baking + signing have
  // completed. Sequential so hook stdout/stderr lines from different
  // targets don't interleave on the user's terminal.
  const pkg = pkgOptions.get();
  if (pkg.postBuild !== undefined) {
    for (const target of opts.targets) {
      if (target.output) {
        await runPostBuild(pkg, target.output);
      }
    }
  }
}

/** Create NodeJS executable using sea */
export default async function sea(entryPoint: string, opts: SeaOptions) {
  assertHostSeaNodeVersion();
  assertSingleTargetMajor(opts.targets);

  entryPoint = resolve(process.cwd(), entryPoint);

  if (!(await exists(entryPoint))) {
    throw new Error(`Entrypoint path "${entryPoint}" does not exist`);
  }

  const nodePaths = await Promise.all(
    opts.targets.map((target) => getNodejsExecutable(target, opts)),
  );

  await withSeaTmpDir(async (tmpDir) => {
    // docs: https://nodejs.org/api/single-executable-applications.html
    const blobPath = join(tmpDir, 'sea-prep.blob');
    const seaConfigFilePath = join(tmpDir, 'sea-config.json');
    const seaConfig = {
      main: entryPoint,
      output: blobPath,
      ...{
        ...defaultSeaConfig,
        ...(opts.seaConfig || {}),
      },
    };

    log.info('Creating sea-config.json file...');
    await writeFile(seaConfigFilePath, JSON.stringify(seaConfig));

    await generateSeaBlob(
      seaConfigFilePath,
      await pickBlobGeneratorBinary(opts.targets, nodePaths, opts),
    );

    const blobData = await readFile(blobPath);

    await Promise.all(
      nodePaths.map(async (nodePath, i) => {
        const target = opts.targets[i];
        await bake(nodePath, target, blobData);
        await signMacOSIfNeeded(target.output!, target, opts.signature, true);
      }),
    );
  });

  // Simple SEA mode supports postBuild but not transform — there's no
  // walker output to apply per-file rewrites to. preBuild already ran in
  // index.ts before this function was called.
  const pkg = pkgOptions.get();
  if (pkg.postBuild !== undefined) {
    for (const target of opts.targets) {
      if (target.output) {
        await runPostBuild(pkg, target.output);
      }
    }
  }
}
