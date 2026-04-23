import assert from 'assert';
import { existsSync, readFileSync, copyFileSync } from 'fs';
import { mkdir, rm, stat } from 'fs/promises';
import { need, system } from '@yao-pkg/pkg-fetch';
import path from 'path';

import { log, wasReported } from './log';
import help from './help';
import packer from './packer';
import { plusx } from './chmod';
import producer from './producer';
import refine from './refiner';
import { shutdown } from './fabricator';
import walk, { Marker, WalkerParams } from './walker';
import {
  Target,
  NodeTarget,
  SymLinks,
  PkgExecOptions,
  PkgCompressType,
} from './types';
import { CompressType } from './compress_type';
import { signMachOExecutable } from './mach-o';
import pkgOptions from './options';
import sea, { seaEnhanced, signMacOSIfNeeded } from './sea';
import {
  parseInput,
  resolveConfig,
  isConfiguration,
  stringifyTarget,
} from './config';

export type { PkgExecOptions, PkgCompressType };

const { version } = JSON.parse(
  readFileSync(path.join(__dirname, '../package.json'), 'utf-8'),
);

function buildMarker(
  configJson: Record<string, unknown> | undefined,
  config: string | undefined,
  inputJson: Record<string, unknown> | undefined,
  input: string,
): Marker {
  const marker: Marker = configJson
    ? { config: configJson, base: path.dirname(config!), configPath: config! }
    : {
        config: inputJson || {},
        base: path.dirname(input),
        configPath: input,
      };
  marker.toplevel = true;
  return marker;
}

// http://www.openwall.com/lists/musl/2012/12/08/4

const { hostArch, hostPlatform } = system;

function fabricatorForTarget({ nodeRange, arch }: NodeTarget) {
  let fabPlatform = hostPlatform;

  if (
    hostArch !== arch &&
    (hostPlatform === 'linux' || hostPlatform === 'alpine')
  ) {
    // With linuxstatic, it is possible to generate bytecode for different
    // arch with simple QEMU configuration instead of the entire sysroot.
    fabPlatform = 'linuxstatic';
  }

  return {
    nodeRange,
    platform: fabPlatform,
    arch,
  };
}

const dryRunResults: Record<string, boolean> = {};

async function needWithDryRun({
  forceBuild,
  nodeRange,
  platform,
  arch,
}: NodeTarget) {
  const result = await need({
    dryRun: true,
    forceBuild,
    nodeRange,
    platform,
    arch,
  });
  assert(['exists', 'fetched', 'built'].indexOf(result) >= 0);
  dryRunResults[result] = true;
}

const targetsCache: Record<string, string> = {};

async function needViaCache(target: NodeTarget) {
  const s = stringifyTarget(target);
  let c = targetsCache[s];

  if (c) {
    return c;
  }

  const { forceBuild, nodeRange, platform, arch } = target;

  c = await need({
    forceBuild,
    nodeRange,
    platform,
    arch,
  });

  targetsCache[s] = c;

  return c;
}

export async function exec(argv: string[]): Promise<void>;
export async function exec(options: PkgExecOptions): Promise<void>;
export async function exec(
  argvOrOptions: string[] | PkgExecOptions,
): Promise<void> {
  const parsed = parseInput(argvOrOptions);

  if (parsed.help) {
    help();
    return;
  }
  if (parsed.version) {
    console.log(version);
    return;
  }

  log.info(`pkg@${version}`);

  // Single "understand what the user asked for" step. Downstream never
  // touches raw argv / configJson for behavior decisions.
  const {
    input,
    inputFin,
    inputJson,
    config,
    configJson,
    pkg,
    flags,
    forceBuild,
    targets: resolvedTargets,
  } = await resolveConfig(parsed);

  if (flags.debug) {
    log.debugMode = true;
  }

  if (flags.compress !== CompressType.None) {
    log.info(`compression: ${CompressType[flags.compress]}`);
  }

  // Targets come fully resolved (host defaults applied, output paths
  // assigned, input-overwrite guards enforced). Widen to the build-time
  // shape so the fetch loop can attach binaryPath / fabricator.
  const targets = resolvedTargets as Array<NodeTarget & Partial<Target>>;

  const bakes = (flags.bakeOptions ?? []).map((bake) => `--${bake}`);

  // marker + options (shared between SEA and traditional pipelines)
  pkgOptions.set(pkg);
  const marker = buildMarker(configJson, config, inputJson, input);

  // public / no-dict flags (shared between SEA and traditional pipelines)
  const params: WalkerParams = {};

  if (flags.public) {
    params.publicToplevel = true;
  }

  if (flags.publicPackages) {
    params.publicPackages = flags.publicPackages.includes('*')
      ? ['*']
      : flags.publicPackages;
  }

  if (flags.noDictionary) {
    params.noDictionary = flags.noDictionary.includes('*')
      ? ['*']
      : flags.noDictionary;
  }

  if (flags.sea) {
    if (inputJson || configJson) {
      // Enhanced SEA mode — use walker pipeline.
      // seaEnhanced validates the host Node version and minTargetMajor itself.
      await seaEnhanced(inputFin, {
        targets,
        signature: flags.signature,
        marker,
        params: { ...params, seaMode: true },
        addition: isConfiguration(input) ? input : undefined,
        doCompress: flags.compress,
      });
    } else {
      // Simple SEA mode — plain .js file without package.json.
      // No walker → no per-file archive → nothing to compress here.
      if (flags.compress !== CompressType.None) {
        throw wasReported(
          'Simple SEA mode (--sea without a package.json) does not support --compress. ' +
            'Add a package.json with a "pkg" / "bin" entry to use the enhanced SEA pipeline, ' +
            'which supports compression.',
        );
      }
      await sea(inputFin, {
        targets,
        signature: flags.signature,
      });
    }
    return;
  }

  // fetch targets

  const { bytecode, nativeBuild } = flags;

  for (const target of targets) {
    target.forceBuild = forceBuild;

    await needWithDryRun(target);

    target.fabricator = fabricatorForTarget(target) as Target;

    if (bytecode) {
      await needWithDryRun({
        ...target.fabricator,
        forceBuild,
      });
    }
  }

  if (dryRunResults.fetched && !dryRunResults.built) {
    log.info('Fetching base Node.js binaries to PKG_CACHE_PATH');
  }

  for (const target of targets) {
    target.binaryPath = await needViaCache(target);
    const f = target.fabricator;

    if (f && bytecode) {
      f.binaryPath = await needViaCache(f as NodeTarget);

      if (f.platform === 'macos') {
        // ad-hoc sign the base binary temporarily to generate bytecode
        // due to the new mandatory signing requirement
        const signedBinaryPath = `${f.binaryPath}-signed`;
        await rm(signedBinaryPath, { recursive: true, force: true });
        copyFileSync(f.binaryPath, signedBinaryPath);
        try {
          signMachOExecutable(signedBinaryPath);
        } catch {
          throw wasReported('Cannot generate bytecode', [
            'pkg fails to run "codesign" utility. Due to the mandatory signing',
            'requirement of macOS, executables must be signed. Please ensure the',
            'utility is installed and properly configured.',
          ]);
        }
        f.binaryPath = signedBinaryPath;
      }

      if (f.platform !== 'win') {
        await plusx(f.binaryPath);
      }
    }
  }

  // records

  let records;
  let entrypoint = inputFin;
  let symLinks: SymLinks;
  const addition = isConfiguration(input) ? input : undefined;

  const walkResult = await walk(marker, entrypoint, addition, params);
  entrypoint = walkResult.entrypoint;

  records = walkResult.records;
  symLinks = walkResult.symLinks;

  const refineResult = refine(records, entrypoint, symLinks);
  entrypoint = refineResult.entrypoint;
  records = refineResult.records;
  symLinks = refineResult.symLinks;

  const backpack = packer({ records, entrypoint, bytecode, symLinks });

  log.debug('Targets:', JSON.stringify(targets, null, 2));

  for (const target of targets) {
    if (target.output && existsSync(target.output)) {
      if ((await stat(target.output)).isFile()) {
        await rm(target.output, { recursive: true, force: true });
      } else {
        throw wasReported('Refusing to overwrite non-file output', [
          target.output,
        ]);
      }
    } else if (target.output) {
      await mkdir(path.dirname(target.output), { recursive: true });
    }

    await producer({
      backpack,
      bakes,
      slash: target.platform === 'win' ? '\\' : '/',
      target: target as Target,
      symLinks,
      doCompress: flags.compress,
      nativeBuild,
      fallbackToSource: flags.fallbackToSource,
    });

    if (target.platform !== 'win' && target.output) {
      await signMacOSIfNeeded(target.output, target, flags.signature);
      await plusx(target.output);
    }
  }

  shutdown();
}
