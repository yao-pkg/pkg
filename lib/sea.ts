import { exec as cExec } from 'child_process';
import util from 'util';
import { basename, dirname, join, resolve } from 'path';
import { copyFile, writeFile, rm, mkdir, stat, readFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { ReadableStream } from 'stream/web';
import { createHash } from 'crypto';
import { homedir, tmpdir } from 'os';
import unzipper from 'unzipper';
import { extract as tarExtract } from 'tar';
import { log } from './log';
import { NodeTarget, Target } from './types';

const exec = util.promisify(cExec);

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
  useSnapshot: boolean;
  useCodeCache: boolean;
};

export type SeaOptions = {
  seaConfig?: SeaConfig;
  targets: (NodeTarget & Partial<Target>)[];
} & GetNodejsExecutableOptions;

const defaultSeaConfig: SeaConfig = {
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
};

async function downloadFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download file from ${url}`);
  }

  const fileStream = createWriteStream(filePath);
  return pipeline(response.body as unknown as ReadableStream, fileStream);
}

async function extract(os: string, archivePath: string): Promise<string> {
  const nodeDir = basename(archivePath, os === 'win32' ? '.zip' : '.tar.gz');
  const archiveDir = dirname(archivePath);
  let nodePath = '';

  if (os === 'win32') {
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

const allowedArchs = ['x64', 'arm64', 'armv7l', 'ppc64', 's390x'];
const allowedOSs = ['darwin', 'linux', 'win32'];

function getNodeOs(platform: string) {
  const platformsMap: Record<string, string> = {
    macos: 'darwin',
    win: 'win32',
  };

  const validatedPlatform = platformsMap[platform] || platform;

  if (!allowedOSs.includes(validatedPlatform)) {
    throw new Error(`Unsupported OS: ${platform}`);
  }

  return validatedPlatform;
}

function getNodeArch(arch: string) {
  if (!allowedArchs.includes(arch)) {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  return arch;
}

async function getNodeVersion(nodeVersion: string) {
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

  const response = await fetch('https://nodejs.org/dist/index.json');

  if (!response.ok) {
    throw new Error('Failed to fetch node versions');
  }

  const versions = await response.json();

  const latestVersion = versions
    .map((v: { version: string }) => v.version)
    .find((v: string) => v.startsWith(`v${nodeVersion}`));

  if (!latestVersion) {
    throw new Error(`Node version ${nodeVersion} not found`);
  }

  return latestVersion;
}

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

  const nodeVersion = await getNodeVersion(
    target.nodeRange.replace('node', ''),
  );

  const os = getNodeOs(target.platform);
  const arch = getNodeArch(target.arch);

  const fileName = `node-${nodeVersion}-${os}-${arch}.${os === 'win32' ? 'zip' : 'tar.gz'}`;
  const url = `https://nodejs.org/dist/${nodeVersion}/${fileName}`;
  const checksumUrl = `https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`;
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

  log.info('Verifying checksum...');
  await verifyChecksum(filePath, checksumUrl, fileName);

  log.info('Extracting the archive...');
  const nodePath = await extract(os, filePath);

  return nodePath;
}

export default async function sea(entryPoint: string, opts: SeaOptions) {
  entryPoint = resolve(process.cwd(), entryPoint);

  if (!(await exists(entryPoint))) {
    throw new Error(`Entrypoint path "${entryPoint}" does not exist`);
  }

  const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
  // check node version, needs to be at least 20.0.0
  if (nodeMajor < 20) {
    throw new Error(
      `SEA support requires as least node v20.0.0, actual node version is ${process.version}`,
    );
  }

  const nodePaths = await Promise.all(
    opts.targets.map((target) => getNodejsExecutable(target, opts)),
  );

  // create a temporary directory for the processing work
  const tmpDir = join(tmpdir(), 'pkg-sea', `${Date.now()}`);

  await mkdir(tmpDir, { recursive: true });

  try {
    // change working directory to the temp directory
    process.chdir(tmpDir);

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

    log.info('Generating the blob...');
    await exec(`node --experimental-sea-config "${seaConfigFilePath}"`);

    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < nodePaths.length; i++) {
      const nodePath = nodePaths[i];
      const target = opts.targets[i];
      const outPath = resolve(process.cwd(), target.output as string);

      log.info(`Creating executable for ${target.nodeRange}-${target.platform}-${target.arch}....`);

      if (!(await exists(dirname(outPath)))) {
        log.error(
          `Output directory "${dirname(outPath)}" does not exist`,
        );
        break;
      }
      //  check if executable_path exists
      if (await exists(outPath)) {
        log.warn(`Executable ${outPath} already exists, will be overwritten`);
      }

      // copy the executable as the output executable
      await copyFile(nodePath, outPath);
      
      log.info('Injecting the blob...');
      await exec(
        `npx postject "${outPath}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
      );
    }
  } catch (error) {
    throw new Error(`Error while creating the executable: ${error}`);
  } finally {
    // cleanup the temp directory
    await rm(tmpDir, { recursive: true });
  }
}
