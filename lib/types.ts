import type { log } from './log';
import { CompressType } from './compress_type';

export interface FileRecord {
  file: string;
  body?: Buffer | string;
  wasTransformed?: boolean; // Track if .mjs was transformed to CJS
  // This could be improved a bit. making this stricter opens up a lot of
  // changes that need to be made throughout the code though
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: number]: any;
}

export type FileRecords = Record<string, FileRecord>;

type License =
  | string
  | {
      type: string;
    };

export type Patches = Record<
  string,
  string & { do: 'erase' | 'prepend' | 'append' }[]
>;

export type ConfigDictionary = Record<
  string,
  {
    pkg?: {
      dependencies?: Record<string, string>;
    };
    dependencies?: Record<string, string>;
  }
>;

export interface PkgOptions {
  scripts?: string[];
  log?: (logger: typeof log, context: Record<string, string>) => void;
  assets?: string[];
  ignore?: string[];
  deployFiles?: string[];
  patches?: Patches;
  dictionary: ConfigDictionary;
}

export interface PackageJson {
  name?: string;
  private?: boolean;
  licenses?: License;
  license?: License;
  main?: string;
  dependencies?: Record<string, string>;
  files?: string[];
  pkg?: PkgOptions;
}

export const platform = {
  macos: 'darwin',
  win: 'win32',
  linux: 'linux',
};

/**
 * Canonical Node.js version string as produced by nodejs.org/dist and
 * `process.version`: `v<major>.<minor>.<patch>`. Always v-prefixed —
 * downstream consumers rely on the prefix to build archive filenames
 * (`node-v22.22.2-linux-x64.tar.gz`) and to compare against
 * `process.version`.
 */
export type NodeVersion = `v${number}.${number}.${number}`;

/**
 * pkg's `nodeRange` format: `node<bare-semver-fragment>` (e.g. `node22`,
 * `node22.22.2`). Matches `NodeTarget.nodeRange` by convention.
 */
export type NodeRange = `node${string}`;

/** OS segment used in nodejs.org archive filenames. */
export const NODE_OSES = ['darwin', 'linux', 'win'] as const;
export type NodeOs = (typeof NODE_OSES)[number];

/** Arch segment used in nodejs.org archive filenames. */
export const NODE_ARCHS = [
  'x64',
  'arm64',
  'armv7l',
  'ppc64',
  's390x',
  'riscv64',
  'loong64',
] as const;
export type NodeArch = (typeof NODE_ARCHS)[number];

export interface NodeTarget {
  nodeRange: string;
  arch: string;
  platform: keyof typeof platform;
  forceBuild?: boolean;
}

export interface Target extends NodeTarget {
  binaryPath: string;
  output: string;
  fabricator: Target;
}

export interface Marker {
  hasDictionary?: boolean;
  activated?: boolean;
  toplevel?: boolean;
  public?: boolean;
  hasDeployFiles?: boolean;
  config?: PackageJson;
  configPath: string;
  base: string;
}

export interface WalkerParams {
  publicToplevel?: boolean;
  publicPackages?: string[];
  noDictionary?: string[];
  seaMode?: boolean;
}

export interface SeaEnhancedOptions {
  seaConfig?: {
    disableExperimentalSEAWarning?: boolean;
    useSnapshot?: boolean;
    useCodeCache?: boolean;
  };
  signature?: boolean;
  targets: (NodeTarget & Partial<Target>)[];
  useLocalNode?: boolean;
  nodePath?: string;
  marker: Marker;
  params: WalkerParams;
  addition?: string;
  doCompress?: CompressType;
}

export type SymLinks = Record<string, string>;
