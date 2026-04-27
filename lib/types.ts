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

// CompressType is a numeric enum, so `keyof typeof` would include the
// reverse-mapped numeric keys (0 | 1 | ...). Exclude them so only the
// named variants (`'None' | 'Brotli' | ...`) are accepted.
export type PkgCompressType = Exclude<keyof typeof CompressType, number>;

/**
 * Build hook called once before the walker collects files. Use for setup
 * work like pre-bundling with esbuild/webpack, codegen, or fetching assets.
 *
 * Function form takes no arguments; throw or return a rejected promise to
 * abort the build.
 */
export type PreBuildHook = () => void | Promise<void>;

/**
 * Build hook called once per produced binary, after it has been written
 * (and codesigned/chmodded on macOS/Linux). Use for smoke tests, signing,
 * notarization, upload, etc.
 *
 * Function form receives the absolute output path. Shell form receives it
 * via the `PKG_OUTPUT` env var. Throw / non-zero exit to fail the build.
 */
export type PostBuildHook = (output: string) => void | Promise<void>;

/**
 * Per-file transform applied after the walker collects files and after
 * refinement, but before bytecode compilation and compression. Use for
 * minification, obfuscation, or any other content rewrite.
 *
 * Receives the absolute on-disk file path and the current contents (a
 * Buffer when loaded from disk, a string when an earlier step rewrote it).
 * Return the replacement bytes/string to apply, or `undefined`/`void` to
 * leave the file unchanged.
 */
export type TransformHook = (
  filePath: string,
  contents: Buffer | string,
) =>
  | string
  | Buffer
  | void
  | undefined
  | Promise<string | Buffer | void | undefined>;

export interface PkgOptions {
  scripts?: string[];
  log?: (logger: typeof log, context: Record<string, string>) => void;
  assets?: string[];
  ignore?: string[];
  /**
   * Files that must be shipped next to the executable instead of bundled.
   * Each entry is a tuple `[from, to]` or `[from, to, 'directory']` where
   * `from` is the source path (relative to the package) and `to` is the
   * destination path relative to the output binary.
   */
  deployFiles?: Array<[string, string] | [string, string, 'directory']>;
  patches?: Patches;
  dictionary?: ConfigDictionary;
  targets?: string | string[];
  outputPath?: string;
  compress?: PkgCompressType;
  fallbackToSource?: boolean;
  public?: boolean;
  publicPackages?: string | string[];
  options?: string | string[];
  bytecode?: boolean;
  nativeBuild?: boolean;
  noDictionary?: string | string[];
  debug?: boolean;
  signature?: boolean;
  sea?: boolean;
  /**
   * Shell command (string) or JS function run once before the walker.
   * Function form is only reachable via the Node.js API or a `pkg.config.js`
   * file — JSON config files can only carry the shell form.
   */
  preBuild?: string | PreBuildHook;
  /**
   * Shell command (string) or JS function run once per produced binary.
   * Shell form receives the output path via `PKG_OUTPUT`.
   */
  postBuild?: string | PostBuildHook;
  /**
   * Per-file content transform. Function form only — shell-string transforms
   * are not supported because piping every file through a child process
   * would be prohibitively slow.
   */
  transform?: TransformHook;
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

export interface PkgExecOptions {
  /** Entry file or directory (required). */
  input: string;
  /** Target specs, e.g. `['node22-linux-x64']` or `['host']`. */
  targets?: string[];
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
  publicPackages?: string[];
  /** Package names to ignore dictionaries for. `['*']` to disable all. */
  noDictionary?: string[];
  /** Sign macOS binaries when applicable. Default `true`. */
  signature?: boolean;
  /**
   * Shell command (string) or JS function run once before the walker
   * collects files. Throw or reject to abort the build.
   */
  preBuild?: string | PreBuildHook;
  /**
   * Shell command (string) or JS function run once per produced binary,
   * after it has been written. Function form receives the output path;
   * shell form receives it via `PKG_OUTPUT`.
   */
  postBuild?: string | PostBuildHook;
  /**
   * Per-file content transform applied after walking and refinement, before
   * bytecode and compression. Use for minify/obfuscate; receives
   * `(filePath, contents)` and returns the replacement (or void to keep).
   */
  transform?: TransformHook;
}
