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
import { NodeTarget, Target, SeaEnhancedOptions } from './types';
import {
  patchMachOExecutable,
  removeMachOExecutableSignature,
  signMachOExecutable,
} from './mach-o';
import walk from './walker';
import refine from './refiner';
import { generateSeaAssets } from './sea-assets';
import { inject as postjectInject } from 'postject';

const execFileAsync = util.promisify(cExecFile);

/** Returns stat of path when exits, false otherwise */
const exists = async (path: string) => {
  try {
    return await stat(path);
  } catch {
    return false;
  }
};

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
async function extract(os: string, archivePath: string): Promise<string> {
  const nodeDir = basename(archivePath, os === 'win' ? '.zip' : '.tar.gz');
  const archiveDir = dirname(archivePath);
  let nodePath = '';

  if (os === 'win') {
    // use unzipper to extract the archive
    const { files } = await unzipper.Open.file(archivePath);
    const nodeBinPath = `${nodeDir}/node.exe`;

    const nodeBin = files.find((file) => file.path === nodeBinPath);

    if (!nodeBin) {
      throw new Error('Node executable not found in the archive');
    }

    nodePath = join(archiveDir, `${nodeDir}.exe`);

    // extract the node executable
    await pipeline(nodeBin.stream(), createWriteStream(nodePath));
  } else {
    const nodeBinPath = `${nodeDir}/bin/node`;

    // use tar to extract the archive
    await tarExtract({
      file: archivePath,
      cwd: archiveDir,
      filter: (path) => path === nodeBinPath,
    });

    // check if the node executable exists
    nodePath = join(archiveDir, nodeBinPath);
  }

  // check if the node executable exists
  if (!(await exists(nodePath))) {
    throw new Error('Node executable not found in the archive');
  }

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
function getNodeOs(platform: string) {
  const allowedOSs = ['darwin', 'linux', 'win'];
  const platformsMap: Record<string, string> = {
    macos: 'darwin',
  };

  const validatedPlatform = platformsMap[platform] || platform;

  if (!allowedOSs.includes(validatedPlatform)) {
    throw new Error(`Unsupported OS: ${platform}`);
  }

  return validatedPlatform;
}

/** Get the node arch based on target arch */
function getNodeArch(arch: string) {
  const allowedArchs = [
    'x64',
    'arm64',
    'armv7l',
    'ppc64',
    's390x',
    'riscv64',
    'loong64',
  ];

  if (!allowedArchs.includes(arch)) {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  return arch;
}

/** Get latest node version based on the provided partial version */
async function getNodeVersion(os: string, arch: string, nodeVersion: string) {
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
    return nodeVersion;
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

  const versions = await response.json();

  const nodeOS = os === 'darwin' ? 'osx' : os;
  const latestVersionAndFiles = versions
    .map((v: { version: string; files: string[] }) => [v.version, v.files])
    .find(
      ([v, files]: [string, string[]]) =>
        v.startsWith(`v${nodeVersion}`) &&
        files.find((f: string) => f.startsWith(`${nodeOS}-${arch}`)),
    );

  if (!latestVersionAndFiles) {
    throw new Error(`Node version ${nodeVersion} not found`);
  }

  return latestVersionAndFiles[0];
}

/** Fetch, validate and extract nodejs binary. Returns a path to it */
async function getNodejsExecutable(
  target: NodeTarget,
  opts: GetNodejsExecutableOptions,
) {
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

  const nodeVersion = await getNodeVersion(
    os,
    arch,
    target.nodeRange.replace('node', ''),
  );

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

  // skip download if file exists
  if (!(await exists(filePath))) {
    log.info(`Downloading nodejs executable from ${url}...`);
    await downloadFile(url, filePath);
  }

  log.info(`Verifying checksum of ${fileName}`);
  await verifyChecksum(filePath, checksumUrl, fileName);

  log.info(`Extracting node binary from ${fileName}`);
  const nodePath = await extract(os, filePath);

  return nodePath;
}

/** Bake the blob into the executable */
async function bake(
  nodePath: string,
  target: NodeTarget & Partial<Target>,
  blobPath: string,
) {
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
  if (target.platform === 'macos') {
    // codesign is only available on macOS — skip signature removal when
    // cross-compiling from another platform
    if (process.platform === 'darwin') {
      removeMachOExecutableSignature(outPath);
    }
  }

  // Use postject JS API directly instead of spawning npx.
  // This avoids two CI issues:
  // 1. "Text file busy" race condition from concurrent npx invocations
  // 2. "Argument is not a constructor" from npx downloading incompatible versions
  const blobData = await readFile(blobPath);
  await postjectInject(outPath, 'NODE_SEA_BLOB', blobData, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    machoSegmentName: target.platform === 'macos' ? 'NODE_SEA' : undefined,
    overwrite: true,
  });
}

/** Patch and sign macOS executable if needed */
export async function signMacOSIfNeeded(
  output: string,
  target: NodeTarget & Partial<Target>,
  signature?: boolean,
) {
  if (!signature || target.platform !== 'macos') return;

  const buf = patchMachOExecutable(await readFile(output));
  await writeFile(output, buf);
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
function assertHostSeaNodeVersion() {
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
 * Pick the node binary used to generate the SEA prep blob.
 *
 * The blob layout is node-version specific (e.g. Node 25.8 added an
 * exec_argv_extension header field), so it must be generated by a node
 * major that matches the target — otherwise the target cannot deserialize
 * it. The blob itself is platform/arch-agnostic.
 *
 * Rule:
 *   - host major === minTargetMajor  → use process.execPath. Always
 *     executable regardless of target platform/arch, so this is the only
 *     path that works for cross-platform builds (e.g. Linux x64 host
 *     producing a Windows x64 SEA).
 *   - otherwise                      → use nodePaths[0], the downloaded
 *     target-platform binary. Matches the target major but requires host
 *     to be able to execute it (same platform/arch, or QEMU/Rosetta). A
 *     cross-major + cross-platform build will fail at spawn time — pkg
 *     has no way to produce a host-platform binary of the target major.
 *
 * All targets share a single node major (validated in bin.ts), so
 * inspecting only nodePaths[0] is sufficient.
 */
function pickBlobGeneratorBinary(
  minTargetMajor: number,
  nodePaths: string[],
): string {
  const hostMajor = parseInt(process.version.slice(1), 10);
  if (hostMajor === minTargetMajor) return process.execPath;
  return nodePaths[0];
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
) {
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
    const { assets, manifestPath, entryIsESM } = await generateSeaAssets(
      records,
      refinedEntry,
      symLinks,
      tmpDir,
      { debug: log.debugMode },
    );

    // Use native ESM SEA main when:
    //   - entry is ESM
    //   - target Node supports sea-config mainFormat:"module" (Node 25.7+,
    //     nodejs/node#61813)
    //   - target Node resolves non-builtin modules in the embedder
    //     dynamic-import callback (see nodejs/node#62726 — replace
    //     `MIN_EMBEDDER_IMPORT_FIXED_MAJOR` with the actual first fixed
    //     release once it lands)
    //
    // Otherwise fall back to the CJS bootstrap, which on Node 22.12+
    // transparently loads ESM entries via Module.runMain() → require(esm).
    // The CJS fallback does NOT support top-level await in the user
    // entry — require(esm) rejects TLA modules — which is why the
    // native path is preferred once it is available.
    const MIN_EMBEDDER_IMPORT_FIXED_MAJOR = Number.MAX_SAFE_INTEGER;
    const useNativeEsmMain =
      entryIsESM && minTargetMajor >= MIN_EMBEDDER_IMPORT_FIXED_MAJOR;

    if (entryIsESM && !useNativeEsmMain) {
      log.warn(
        'ESM entrypoint detected; falling back to the CJS SEA bootstrap. Limitations:',
        [
          '- Top-level await in the user entry is not supported (require(esm) rejects TLA).',
          '- Rebuild with a Node target that carries the nodejs/node#62726 fix to enable native sea-config mainFormat:"module".',
        ],
      );
    }

    const bootstrapFile = useNativeEsmMain
      ? 'sea-bootstrap-esm.bundle.mjs'
      : 'sea-bootstrap.bundle.js';
    const bootstrapPath = join(
      tmpDir,
      useNativeEsmMain ? 'sea-main.mjs' : 'sea-main.js',
    );
    await copyFile(
      join(__dirname, '..', 'prelude', bootstrapFile),
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

    if (useNativeEsmMain) {
      // Requires Node 25.7+ — makes the SEA main execute as ESM, enabling
      // native top-level await and sync-import of ESM deps via module hooks.
      seaConfig.mainFormat = 'module';
    }

    const seaConfigFilePath = join(tmpDir, 'sea-config.json');
    log.info('Creating sea-config.json file...');
    await writeFile(seaConfigFilePath, JSON.stringify(seaConfig));

    await generateSeaBlob(
      seaConfigFilePath,
      pickBlobGeneratorBinary(minTargetMajor, nodePaths),
    );

    // Bake blob into each target executable
    await Promise.all(
      nodePaths.map(async (nodePath, i) => {
        const target = opts.targets[i];
        await bake(nodePath, target, blobPath);
        await signMacOSIfNeeded(target.output!, target, opts.signature);
      }),
    );
  });
}

/** Create NodeJS executable using sea */
export default async function sea(entryPoint: string, opts: SeaOptions) {
  assertHostSeaNodeVersion();

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
      pickBlobGeneratorBinary(resolveMinTargetMajor(opts.targets), nodePaths),
    );

    await Promise.all(
      nodePaths.map(async (nodePath, i) => {
        const target = opts.targets[i];
        await bake(nodePath, target, blobPath);
        await signMacOSIfNeeded(target.output!, target, opts.signature);
      }),
    );
  });
}
