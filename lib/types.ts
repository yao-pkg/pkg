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

export type PkgCompressType = keyof typeof CompressType;

export interface PkgExecOptions {
  /** Entry file or directory (required). */
  input: string;
  /** Target spec(s), e.g. 'node22-linux-x64' or 'host'. */
  targets?: string | string[];
  /** Path to a `package.json` or standalone config JSON. */
  config?: string;
  /** Output file name or template for multiple targets. */
  output?: string;
  /** Directory to save the output executable(s). Mutually exclusive with `output`. */
  outputPath?: string;
  /** VFS compression algorithm. Default `'None'`. */
  compress?: PkgCompressType;
  /** Use Node.js Single Executable Application mode. */
  sea?: boolean;
  /** Bake Node/V8 CLI options into the executable (e.g. `['expose-gc']`). */
  bakeOptions?: string | string[];
  /** Enable verbose packaging logs. */
  debug?: boolean;
  /** Build base binaries from source instead of downloading prebuilt ones. */
  build?: boolean;
  /** Compile bytecode. Default `true`. Set to `false` to ship plain JS. */
  bytecode?: boolean;
  /** Build native addons. Default `true`. */
  nativeBuild?: boolean;
  /** If bytecode compilation fails for a file, ship it as plain source. */
  fallbackToSource?: boolean;
  /** Treat the top-level project as public (faster, discloses sources). */
  public?: boolean;
  /** Package names to treat as public. `['*']` for all packages. */
  publicPackages?: string | string[];
  /** Package names to ignore dictionaries for. `['*']` to disable all. */
  noDictionary?: string | string[];
  /** Sign macOS binaries when applicable. Default `true`. */
  signature?: boolean;
}
