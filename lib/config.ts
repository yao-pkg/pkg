import { existsSync, readFileSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseArgs, type ParseArgsConfig } from 'util';
import { system } from '@yao-pkg/pkg-fetch';

import { log, wasReported } from './log';
import { isPackageJson } from './common';
import { CompressType } from './compress_type';
import { NodeTarget, PkgExecOptions, PkgOptions } from './types';

// ---------------------------------------------------------------------------
// File discovery / loading
// ---------------------------------------------------------------------------

/** Auto-discovered config filenames, in precedence order. First match wins. */
export const PKGRC_FILENAMES = [
  '.pkgrc',
  '.pkgrc.json',
  'pkg.config.js',
  'pkg.config.cjs',
  'pkg.config.mjs',
];

/** Return the first `PKGRC_FILENAMES` entry that exists in `baseDir`, or `undefined`. */
export function findPkgrc(baseDir: string): string | undefined {
  for (const name of PKGRC_FILENAMES) {
    const candidate = path.join(baseDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Genuine dynamic `import()` that survives the TS `module: commonjs` rewrite.
 * TS would otherwise turn `import(...)` into `require(...)`, which breaks ESM.
 */
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<{ default?: unknown; [k: string]: unknown }>;

/**
 * Load a pkgrc / pkg.config file. `.pkgrc` and `.json` are read as JSON; `.js`
 * / `.cjs` / `.mjs` are dynamically imported and their default export returned.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadPkgrc(file: string): Promise<any> {
  const base = path.basename(file);
  // `.pkgrc` has no extension and `.pkgrc.json` is JSON only — parse directly.
  if (base === '.pkgrc' || file.endsWith('.json')) {
    return JSON.parse(readFileSync(file, 'utf-8'));
  }
  const mod = await nativeImport(pathToFileURL(file).href);
  return mod.default ?? mod;
}

/** True if `file` is a `package.json` or a `*.config.json` we should treat as one. */
export function isConfiguration(file: string): boolean {
  return isPackageJson(file) || file.endsWith('.config.json');
}

// ---------------------------------------------------------------------------
// Flag registry — single source of truth for every config-overridable flag.
// Each entry maps three coordinates: CLI name, config key, resolved key.
// `option` diverges from `cfg` only when the programmatic API uses a different
// name (legacy `options` vs `bakeOptions` skew).
// ---------------------------------------------------------------------------

/** Value shape of a flag: scalar bool/string, or a comma-joined list. */
type FlagKind = 'bool' | 'string' | 'list';

/** Metadata that ties a single flag's four representations together. */
interface FlagSpec {
  /** CLI long name without `--` (e.g. `'no-dict'`). */
  readonly cli: string;
  /** Key under `pkg` in the config file (e.g. `'noDictionary'`). */
  readonly cfg: keyof PkgOptions;
  /** Programmatic `exec()` option name, if it differs from `cfg`. */
  readonly option?: keyof PkgExecOptions;
  /** Key on the merged `ResolvedFlags` object returned downstream. */
  readonly resolved: keyof ResolvedFlags;
  /** Value kind used to drive parsing, validation, and merging. */
  readonly kind: FlagKind;
  /** Fallback used when neither CLI nor config provides a value. */
  readonly default?: boolean | string;
  /** CLI short alias (e.g. `'C'` for `-C`). */
  readonly short?: string;
}

/**
 * Single source of truth for every config-overridable flag. Drives `parseArgs`
 * options, `--no-*` negations, config validation, programmatic-input mapping,
 * and the CLI > config > default merge. Add a flag by adding one entry here.
 */
const FLAG_SPECS: readonly FlagSpec[] = [
  {
    cli: 'debug',
    cfg: 'debug',
    resolved: 'debug',
    kind: 'bool',
    default: false,
    short: 'd',
  },
  {
    cli: 'bytecode',
    cfg: 'bytecode',
    resolved: 'bytecode',
    kind: 'bool',
    default: true,
  },
  {
    cli: 'native-build',
    cfg: 'nativeBuild',
    resolved: 'nativeBuild',
    kind: 'bool',
    default: true,
  },
  {
    cli: 'signature',
    cfg: 'signature',
    resolved: 'signature',
    kind: 'bool',
    default: true,
  },
  {
    cli: 'fallback-to-source',
    cfg: 'fallbackToSource',
    resolved: 'fallbackToSource',
    kind: 'bool',
    default: false,
  },
  {
    cli: 'public',
    cfg: 'public',
    resolved: 'public',
    kind: 'bool',
    default: false,
  },
  { cli: 'sea', cfg: 'sea', resolved: 'sea', kind: 'bool', default: false },
  {
    cli: 'compress',
    cfg: 'compress',
    resolved: 'compress',
    kind: 'string',
    default: 'None',
    short: 'C',
  },
  {
    cli: 'options',
    cfg: 'options',
    option: 'bakeOptions',
    resolved: 'bakeOptions',
    kind: 'list',
  },
  {
    cli: 'public-packages',
    cfg: 'publicPackages',
    resolved: 'publicPackages',
    kind: 'list',
  },
  {
    cli: 'no-dict',
    cfg: 'noDictionary',
    resolved: 'noDictionary',
    kind: 'list',
  },
];

/** Programmatic option key for a flag (defaults to the config key). */
const optionKey = (s: FlagSpec): keyof PkgExecOptions =>
  (s.option ?? s.cfg) as keyof PkgExecOptions;

// ---------------------------------------------------------------------------
// CLI parsing (util.parseArgs-based)
// ---------------------------------------------------------------------------

/** Token stream returned by `parseArgs({ tokens: true })`. */
type ParseArgsTokens = NonNullable<ReturnType<typeof parseArgs>['tokens']>;

/**
 * Narrowed view of `parseArgs().values` for pkg. `parseArgs` types values as
 * `string | boolean | (string | boolean)[] | undefined` to accommodate
 * `multiple: true`, which pkg does not use — narrowing here keeps every
 * downstream read cast-free.
 */
interface CliValues {
  help?: boolean;
  version?: boolean;
  build?: boolean;
  config?: string;
  output?: string;
  outdir?: string;
  'out-dir'?: string;
  'out-path'?: string;
  target?: string;
  targets?: string;
  [k: string]: string | boolean | undefined;
}

/**
 * Options table handed to `util.parseArgs`. Short-circuits and input/output
 * plumbing are declared here; flag-shaped entries are appended from
 * `FLAG_SPECS` below so they stay in sync.
 */
const PARSE_ARGS_OPTIONS: ParseArgsConfig['options'] = {
  // short-circuits + CLI-only controls
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  build: { type: 'boolean', short: 'b' },

  // non-flag strings (input/output/target plumbing — not in FLAG_SPECS)
  config: { type: 'string', short: 'c' },
  output: { type: 'string', short: 'o' },
  outdir: { type: 'string' },
  'out-dir': { type: 'string' },
  'out-path': { type: 'string' },
  target: { type: 'string', short: 't' },
  targets: { type: 'string' },
};

/**
 * Names for which a `--no-<name>` sibling is registered with `parseArgs`.
 * `parseArgs` does not auto-generate negations, and pkg needs them on every
 * boolean flag plus the CLI-only `--build`.
 */
const NEGATABLE_BOOLS: readonly string[] = [
  'build',
  ...FLAG_SPECS.filter((s) => s.kind === 'bool').map((s) => s.cli),
];

for (const s of FLAG_SPECS) {
  if (s.kind === 'bool') {
    PARSE_ARGS_OPTIONS[s.cli] = s.short
      ? { type: 'boolean', short: s.short }
      : { type: 'boolean' };
  } else {
    PARSE_ARGS_OPTIONS[s.cli] = s.short
      ? { type: 'string', short: s.short }
      : { type: 'string' };
  }
}
for (const name of NEGATABLE_BOOLS) {
  PARSE_ARGS_OPTIONS[`no-${name}`] = { type: 'boolean' };
}

// ---------------------------------------------------------------------------
// ParsedInput — canonical shape produced by CLI and programmatic entry points.
// ---------------------------------------------------------------------------

/** Pre-merge flag values keyed by CLI name; lists are still comma-joined strings. */
export type RawFlags = Record<string, string | boolean | undefined>;

/** Canonical shape produced by both the CLI and programmatic entry points. */
export interface ParsedInput {
  /** `--help` short-circuit. */
  help?: boolean;
  /** `--version` short-circuit. */
  version?: boolean;
  /** Positional entry file or directory. */
  entry?: string;
  /** Explicit config path from `--config` / `options.config`. */
  config?: string;
  /** Output file name from `--output` / `options.output`. */
  output?: string;
  /** Output directory; collapsed from `--out-path` / `--outdir` / `--out-dir`. */
  outputPath?: string;
  /** Raw target spec string (comma-separated), pre-parse. */
  targets?: string;
  /** `--build`: force rebuilding base Node.js binaries from source. */
  build?: boolean;
  /** Pre-merge flag values keyed by CLI name (see `RawFlags`). */
  flags: RawFlags;
  /**
   * Programmatic-API-only `pkg` overrides that don't have a flag/config-file
   * equivalent (currently: function-typed build hooks). Merged into the
   * resolved `pkg` config in `resolveConfig`. The CLI never populates this.
   */
  apiPkg?: Partial<PkgOptions>;
}

/**
 * Collapse every `no-<flag>` value into the canonical `<flag>` key. The token
 * walk establishes last-wins order when both forms are passed (e.g.
 * `--bytecode --no-bytecode`).
 */
function mergeNegations(values: CliValues, tokens: ParseArgsTokens): void {
  for (const name of NEGATABLE_BOOLS) {
    const neg = `no-${name}`;
    if (values[neg] === undefined) continue;
    let lastKind: 'pos' | 'neg' | undefined;
    for (const t of tokens) {
      if (t.kind !== 'option') continue;
      if (t.name === name) lastKind = 'pos';
      else if (t.name === neg) lastKind = 'neg';
    }
    values[name] = lastKind === 'pos';
    delete values[neg];
  }
}

/**
 * Flatten `string | string[]` into a comma-joined string. Empty results (`''`
 * or `[]`) collapse to `undefined` so callers treat them the same as unset.
 */
function joinList(v: string[] | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const joined = Array.isArray(v) ? v.join(',') : v;
  return joined === '' ? undefined : joined;
}

/** Parse raw `argv` into a `ParsedInput`. Used by the CLI entry point. */
function parseCliInput(argv: string[]): ParsedInput {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: PARSE_ARGS_OPTIONS,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
  } catch (err) {
    throw wasReported((err as Error).message);
  }

  const v = parsed.values as CliValues;
  mergeNegations(v, parsed.tokens!);

  if (parsed.positionals.length > 1) {
    throw wasReported('Not more than one entry file/directory is expected');
  }

  // `--target` (short `-t`) and `--targets` are accepted as aliases. Reject
  // both-present up front rather than silently preferring one — parseArgs
  // stores them independently, and order-based "last wins" would require a
  // token walk for a case that's almost certainly a user mistake.
  if (v.target !== undefined && v.targets !== undefined) {
    throw wasReported("Specify either '--target' or '--targets'. Not both");
  }

  const flags: RawFlags = {};
  for (const s of FLAG_SPECS) {
    if (v[s.cli] !== undefined) flags[s.cli] = v[s.cli];
  }

  return {
    help: v.help,
    version: v.version,
    entry: parsed.positionals[0],
    config: v.config,
    output: v.output,
    outputPath: v['out-path'] ?? v.outdir ?? v['out-dir'],
    targets: v.targets ?? v.target,
    build: v.build,
    flags,
  };
}

/**
 * Parse a programmatic `exec()` options object into a `ParsedInput`. Validates
 * each flag's type at the boundary — wrong types throw immediately instead of
 * being silently dropped.
 */
function parseOptionsInput(options: PkgExecOptions): ParsedInput {
  if (!options || typeof options !== 'object') {
    throw wasReported('exec() options must be an object');
  }
  if (!options.input || typeof options.input !== 'string') {
    throw wasReported('exec() options.input is required and must be a string');
  }

  const flags: RawFlags = {};
  for (const s of FLAG_SPECS) {
    const key = String(optionKey(s));
    const v = options[optionKey(s)];
    if (v === undefined) continue;
    if (s.kind === 'bool') {
      if (typeof v !== 'boolean') {
        throw wasReported(`exec() option "${key}" must be a boolean`);
      }
      flags[s.cli] = v;
    } else if (s.kind === 'string') {
      if (typeof v !== 'string') {
        throw wasReported(`exec() option "${key}" must be a string`);
      }
      flags[s.cli] = v;
    } else {
      if (typeof v === 'string') {
        flags[s.cli] = v;
      } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        flags[s.cli] = joinList(v);
      } else {
        throw wasReported(
          `exec() option "${key}" must be a string or string[]`,
        );
      }
    }
  }

  const apiPkg: Partial<PkgOptions> = {};
  const validateShellOrFn = (
    key: 'preBuild' | 'postBuild',
    v: unknown,
  ): void => {
    if (typeof v !== 'string' && typeof v !== 'function') {
      throw wasReported(
        `exec() option "${key}" must be a shell command (string) or a function`,
      );
    }
    if (typeof v === 'string' && v.trim() === '') {
      throw wasReported(`exec() option "${key}" must not be an empty string`);
    }
  };
  if (options.preBuild !== undefined) {
    validateShellOrFn('preBuild', options.preBuild);
    apiPkg.preBuild = options.preBuild;
  }
  if (options.postBuild !== undefined) {
    validateShellOrFn('postBuild', options.postBuild);
    apiPkg.postBuild = options.postBuild;
  }
  if (options.transform !== undefined) {
    if (typeof options.transform !== 'function') {
      throw wasReported(`exec() option "transform" must be a function`);
    }
    apiPkg.transform = options.transform;
  }

  return {
    entry: options.input,
    config: options.config,
    output: options.output,
    outputPath: options.outputPath,
    targets: joinList(options.targets),
    build: options.build,
    flags,
    apiPkg: Object.keys(apiPkg).length ? apiPkg : undefined,
  };
}

/**
 * Parse either an `argv` array (CLI) or an `exec()` options object
 * (programmatic) into the same canonical `ParsedInput` shape.
 */
export function parseInput(
  argvOrOptions: string[] | PkgExecOptions,
): ParsedInput {
  return Array.isArray(argvOrOptions)
    ? parseCliInput(argvOrOptions)
    : parseOptionsInput(argvOrOptions);
}

// ---------------------------------------------------------------------------
// Schema validation (driven by FLAG_SPECS + a small static list)
// ---------------------------------------------------------------------------

/** Keys accepted under `pkg` that are not driven by `FLAG_SPECS`. */
const NON_FLAG_PKG_KEYS = [
  'scripts',
  'assets',
  'ignore',
  'patches',
  'deployFiles',
  'dictionary',
  'log',
  'targets',
  'outputPath',
  'seaConfig',
  'preBuild',
  'postBuild',
  'transform',
] as const;

/** Union of flag-driven and static keys — anything outside this set warns. */
const KNOWN_PKG_KEYS = new Set<string>([
  ...NON_FLAG_PKG_KEYS,
  ...FLAG_SPECS.map((s) => s.cfg),
]);

/**
 * Warn on unknown keys under `pkg` and throw on flag values whose runtime type
 * doesn't match the declared `FlagKind`. No-op when `cfg` is null/undefined.
 */
export function validatePkgConfig(cfg: unknown): void {
  if (!cfg || typeof cfg !== 'object') return;
  const rec = cfg as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!KNOWN_PKG_KEYS.has(key)) {
      log.warn(`Unknown key "${key}" in pkg config — ignoring.`);
    }
  }
  for (const s of FLAG_SPECS) {
    const v = rec[s.cfg];
    if (v === undefined) continue;
    if (s.kind === 'bool') {
      if (typeof v !== 'boolean') {
        throw wasReported(`pkg config: "${s.cfg}" must be a boolean`);
      }
    } else if (s.kind === 'string') {
      if (typeof v !== 'string') {
        throw wasReported(`pkg config: "${s.cfg}" must be a string`);
      }
    } else {
      if (typeof v === 'string') continue;
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) continue;
      throw wasReported(`pkg config: "${s.cfg}" must be a string or string[]`);
    }
  }
  // Hooks: shell-string or function for pre/postBuild, function-only for
  // transform. Functions are unreachable from JSON config files but valid
  // when loaded from `pkg.config.{js,cjs,mjs}` or passed via the Node API.
  for (const key of ['preBuild', 'postBuild'] as const) {
    const v = rec[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' && typeof v !== 'function') {
      throw wasReported(
        `pkg config: "${key}" must be a shell command (string) or a function`,
      );
    }
    if (typeof v === 'string' && v.trim() === '') {
      throw wasReported(`pkg config: "${key}" must not be an empty string`);
    }
  }
  if (rec.transform !== undefined && typeof rec.transform !== 'function') {
    throw wasReported(`pkg config: "transform" must be a function`);
  }
}

// ---------------------------------------------------------------------------
// Flag merge — CLI > pkg config > default. Fully resolved (compress → enum).
// ---------------------------------------------------------------------------

/** Fully merged build-shaping flags (CLI > config > default). */
export interface ResolvedFlags {
  debug: boolean;
  /** `compress` is decoded from its string form into the enum at this layer. */
  compress: CompressType;
  bytecode: boolean;
  nativeBuild: boolean;
  signature: boolean;
  fallbackToSource: boolean;
  public: boolean;
  sea: boolean;
  publicPackages: string[] | undefined;
  noDictionary: string[] | undefined;
  bakeOptions: string[] | undefined;
}

/** Narrow an arbitrary value to `string | string[] | undefined` or `undefined`. */
function toStringList(v: unknown): string | string[] | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
    return v as string[];
  }
  return undefined;
}

/**
 * Merge CLI (comma-joined string) and config (string | string[]) into a
 * cleaned `string[]`. An empty CLI value (`--options ""`) wins over config but
 * collapses to `undefined` so callers treat it the same as unset.
 */
function resolveList(
  cli: string | undefined,
  cfg: string | string[] | undefined,
): string[] | undefined {
  const raw = cli !== undefined ? cli : cfg;
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : raw.split(',');
  const cleaned = list.map((s) => s.trim()).filter((s) => s.length);
  return cleaned.length ? cleaned : undefined;
}

/** Decode a `--compress` string (case-insensitive, with aliases) to `CompressType`. */
function resolveCompress(raw: string): CompressType {
  switch (raw.toLowerCase()) {
    case 'brotli':
    case 'br':
      return CompressType.Brotli;
    case 'gzip':
    case 'gz':
      return CompressType.GZip;
    case 'zstd':
    case 'zs':
      return CompressType.Zstd;
    case 'none':
      return CompressType.None;
    default:
      throw wasReported(
        `Invalid compression algorithm "${raw}" (accepted: None/none, Brotli/br, GZip/gz/gzip, or Zstd/zs/zstd)`,
      );
  }
}

/**
 * Merge raw flag values and `pkg` config into `ResolvedFlags` using the
 * precedence CLI > config > default. Pure: assumes `pkg` has already been
 * validated by the caller (see `resolveConfig`).
 */
export function resolveFlags(raw: RawFlags, pkg: PkgOptions): ResolvedFlags {
  const out: Record<string, unknown> = {};
  for (const s of FLAG_SPECS) {
    if (s.kind === 'list') {
      const rawCli = raw[s.cli];
      const rawCfg = pkg[s.cfg];
      out[s.resolved] = resolveList(
        typeof rawCli === 'string' ? rawCli : undefined,
        toStringList(rawCfg),
      );
    } else {
      const cli = raw[s.cli];
      const cfg = pkg[s.cfg];
      out[s.resolved] =
        cli !== undefined ? cli : cfg !== undefined ? cfg : s.default;
    }
  }
  out.compress = resolveCompress(String(out.compress));
  return out as unknown as ResolvedFlags;
}

/**
 * Write resolved flag values back onto `pkg` so downstream consumers reading
 * the pkg config (`pkgOptions.get()`, dictionary merges, ...) observe CLI
 * overrides. Driven by `FLAG_SPECS` to stay in lockstep with `resolveFlags`.
 */
function applyResolvedFlags(pkg: PkgOptions, flags: ResolvedFlags): PkgOptions {
  const out = { ...pkg } as Record<string, unknown>;
  for (const s of FLAG_SPECS) {
    const v = (flags as unknown as Record<string, unknown>)[s.resolved];
    if (v === undefined) continue;
    // `compress` is the one flag stored as enum on ResolvedFlags but a string
    // literal on PkgOptions — convert back at the boundary.
    out[s.cfg] = s.cli === 'compress' ? CompressType[v as CompressType] : v;
  }
  return out as PkgOptions;
}

// ---------------------------------------------------------------------------
// Phase helpers
// ---------------------------------------------------------------------------

/** Output of `resolveInput`: the entry path plus any package.json context. */
interface ResolvedInput {
  /** Absolute path of the entry, or of `package.json` if `entry` is a directory. */
  input: string;
  /** Entrypoint used by the build: resolved `bin` target if `input` is a package.json-like file, otherwise `input`. */
  inputFin: string;
  /** Parsed `package.json`-like object, or `undefined` for plain JS entries. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputJson: any;
  /** Short name from `inputJson.name` (scope stripped), or `undefined`. */
  inputJsonName: string | undefined;
}

/**
 * Resolve an entry path into its filesystem location and, if it's a package,
 * locate the `bin` target. Throws if the entry or `bin` file doesn't exist.
 */
async function resolveInput(entry: string): Promise<ResolvedInput> {
  let input = path.resolve(entry);
  if (!existsSync(input)) {
    throw wasReported('Input file does not exist', [input]);
  }
  if ((await stat(input)).isDirectory()) {
    input = path.join(input, 'package.json');
    if (!existsSync(input)) {
      throw wasReported('Input file does not exist', [input]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inputJson: any;
  let inputJsonName: string | undefined;
  if (isConfiguration(input)) {
    inputJson = JSON.parse(await readFile(input, 'utf-8'));
    inputJsonName = inputJson.name
      ? (inputJson.name as string).split('/').pop()
      : undefined;
  }

  let inputBin: string | undefined;
  if (inputJson) {
    let { bin } = inputJson;
    if (bin) {
      if (typeof bin === 'object') {
        if (inputJsonName && bin[inputJsonName]) {
          bin = bin[inputJsonName];
        } else {
          bin = bin[Object.keys(bin)[0]];
        }
      }
      inputBin = path.resolve(path.dirname(input), bin);
      if (!existsSync(inputBin)) {
        throw wasReported(
          "Bin file does not exist (taken from package.json 'bin' property)",
          [inputBin],
        );
      }
    }
    if (!inputBin) {
      throw wasReported("Property 'bin' does not exist in", [input]);
    }
  }

  return { input, inputFin: inputBin || input, inputJson, inputJsonName };
}

/** Output of `resolveConfigFile`: the resolved config path and its parsed JSON. */
interface ResolvedConfigFile {
  /** Absolute path of the config file, or `undefined` when none was used. */
  config: string | undefined;
  /** Parsed config contents (may be wrapped — see `resolveConfigFile`). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configJson: any;
}

/**
 * Resolve the config file: use `explicit` if given, else auto-discover via
 * `findPkgrc`. Normalizes bare pkg-config shapes into `{ pkg: ... }` and warns
 * when both a pkgrc and a `package.json` `pkg` field are present.
 */
async function resolveConfigFile(
  explicit: string | undefined,
  input: string,
  inputJson: { pkg?: unknown } | undefined,
): Promise<ResolvedConfigFile> {
  if (inputJson && explicit) {
    throw wasReported("Specify either 'package.json' or config. Not both");
  }

  let config = explicit;
  if (!explicit) {
    const discovered = findPkgrc(path.dirname(input));
    if (discovered) {
      config = discovered;
      log.info(`Using config ${path.relative(process.cwd(), discovered)}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let configJson: any;
  if (config) {
    config = path.resolve(config);
    if (!existsSync(config)) {
      throw wasReported('Config file does not exist', [config]);
    }
    configJson = await loadPkgrc(config);
    // Bare pkg config (no package-like keys) gets wrapped.
    if (
      !configJson.name &&
      !configJson.files &&
      !configJson.dependencies &&
      !configJson.pkg
    ) {
      configJson = { pkg: configJson };
    }
  }

  if (!explicit && config && inputJson?.pkg) {
    log.warn(
      `Both ${path.basename(config)} and "pkg" field in package.json were found. ` +
        `The ${path.basename(config)} file takes precedence.`,
    );
  }

  return { config, configJson };
}

/**
 * Compute the single base output path. Returns `autoOutput: true` when the
 * path was derived (rather than taken from `--output`), which signals that
 * target-specific suffixes should be appended by `assignTargetOutputs`.
 */
function resolveOutput(
  cliOutput: string | undefined,
  cliOutputPath: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputJson: any,
  inputJsonName: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configJson: any,
  pkg: PkgOptions,
  inputFin: string,
  entry: string,
): { output: string; autoOutput: boolean } {
  if (cliOutput && cliOutputPath) {
    throw wasReported("Specify either 'output' or 'out-path'. Not both");
  }

  if (cliOutput) {
    return { output: path.resolve(cliOutput), autoOutput: false };
  }

  let name: string | undefined;
  if (inputJson) {
    name = inputJsonName;
    if (!name) {
      throw wasReported("Property 'name' does not exist in", [entry]);
    }
  } else if (configJson) {
    name = configJson.name;
  }
  if (!name) name = path.basename(inputFin);

  const outputPath = cliOutputPath ?? pkg.outputPath ?? '';

  const ext = path.extname(name);
  const base = name.slice(0, -ext.length || undefined);
  return { output: path.resolve(outputPath, base), autoOutput: true };
}

// ---------------------------------------------------------------------------
// Targets — spec parse + host defaults + per-target output naming.
// ---------------------------------------------------------------------------

const {
  hostArch,
  hostPlatform,
  isValidNodeRange,
  knownArchs,
  knownPlatforms,
  toFancyArch,
  toFancyPlatform,
} = system;

/** `node<major>` for the running Node.js version, used as the default nodeRange. */
const hostNodeRange = `node${process.version.match(/^v(\d+)/)![1]}`;

/**
 * Expand target spec strings into `NodeTarget`s. Each item is split on `-`
 * and tokens are classified as nodeRange / platform / arch; missing parts
 * fall back to the host. `'host'` short-circuits to the full host triple.
 *
 * Exported for unit tests — production callers go through `resolveTargetList`.
 */
export function parseTargets(items: string[]): NodeTarget[] {
  const targets: NodeTarget[] = [];
  for (const item of items) {
    const target = {
      nodeRange: hostNodeRange,
      platform: hostPlatform,
      arch: hostArch,
    };
    if (item !== 'host') {
      for (const token of item.split('-')) {
        if (!token) continue;
        if (isValidNodeRange(token)) {
          target.nodeRange = token;
          continue;
        }
        const p = toFancyPlatform(token);
        if (knownPlatforms.indexOf(p) >= 0) {
          target.platform = p;
          continue;
        }
        const a = toFancyArch(token);
        if (knownArchs.indexOf(a) >= 0) {
          target.arch = a;
          continue;
        }
        throw wasReported(`Unknown token '${token}' in '${item}'`);
      }
    }
    targets.push(target as NodeTarget);
  }
  return targets;
}

/** Format a target back into its canonical `node<range>-<platform>-<arch>` spec. */
export function stringifyTarget(t: NodeTarget): string {
  return `${t.nodeRange}-${t.platform}-${t.arch}`;
}

/** Which parts of a target vary across a list (used to pick output suffixes). */
export interface DifferentParts {
  nodeRange?: boolean;
  platform?: boolean;
  arch?: boolean;
}

/**
 * Return the axes on which `targets` actually differ.
 *
 * Exported for unit tests — production callers go through `resolveConfig`.
 */
export function differentParts(targets: NodeTarget[]): DifferentParts {
  const nr = new Set<string>();
  const pl = new Set<string>();
  const ar = new Set<string>();
  for (const t of targets) {
    nr.add(t.nodeRange);
    pl.add(t.platform);
    ar.add(t.arch);
  }
  const r: DifferentParts = {};
  if (nr.size > 1) r.nodeRange = true;
  if (pl.size > 1) r.platform = true;
  if (ar.size > 1) r.arch = true;
  return r;
}

/**
 * Build a per-target output filename by appending only the target axes that
 * actually differ across the target list, avoiding redundant `-x64`, etc.
 *
 * Exported for unit tests — production callers go through `assignTargetOutputs`.
 */
export function stringifyTargetForOutput(
  baseOutput: string,
  t: NodeTarget,
  diff: DifferentParts,
): string {
  const a = [baseOutput];
  if (diff.nodeRange) a.push(t.nodeRange);
  if (diff.platform) a.push(t.platform);
  if (diff.arch) a.push(t.arch);
  return a.join('-');
}

/** `NodeTarget` with its final output path attached. */
export type ResolvedTarget = NodeTarget & { output: string };

/**
 * Resolve the list of build targets from CLI/config spec. Falls back to
 * `['linux','macos','win']` when the output name was auto-derived, else to
 * `['host']` — preserving historical pkg behavior for bare invocations.
 */
function resolveTargetList(
  cliTargets: string | undefined,
  pkg: PkgOptions,
  autoOutput: boolean,
): NodeTarget[] {
  let spec: string[] = [];
  if (cliTargets) {
    spec = cliTargets
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (pkg.targets) {
    spec = Array.isArray(pkg.targets)
      ? pkg.targets.map((s) => s.trim()).filter(Boolean)
      : String(pkg.targets)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
  }

  let targets = parseTargets(spec);
  if (!targets.length) {
    targets = autoOutput
      ? parseTargets(['linux', 'macos', 'win'])
      : parseTargets(['host']);
    log.info(
      'Targets not specified. Assuming:',
      targets.map(stringifyTarget).join(', '),
    );
  }
  return targets;
}

/**
 * Attach a per-target output path. Adds `.exe` on Windows and disambiguates
 * multi-target builds. Throws if a resolved path would overwrite the input
 * file unless the name was auto-derived (in which case a platform suffix is
 * appended to dodge the collision).
 */
function assignTargetOutputs(
  targets: NodeTarget[],
  baseOutput: string,
  autoOutput: boolean,
  inputFin: string,
): ResolvedTarget[] {
  const diff = differentParts(targets);
  const single = targets.length === 1;

  return targets.map((t) => {
    let file = single
      ? baseOutput
      : stringifyTargetForOutput(baseOutput, t, diff);
    if (t.platform === 'win' && path.extname(file) !== '.exe') file += '.exe';

    if (file === inputFin) {
      if (autoOutput) {
        file += `-${t.platform}`;
      } else {
        throw wasReported('Refusing to overwrite input file', [inputFin]);
      }
    }
    return { ...t, output: file };
  });
}

// ---------------------------------------------------------------------------
// End-to-end entry: orchestrates phase helpers. This is the single "understand
// what the user asked for" step that exec() runs before any build work.
// ---------------------------------------------------------------------------

/**
 * Fully resolved input to `exec()`: every precedence decision (CLI > config >
 * default) has been made, targets are expanded, and output paths are assigned.
 * Downstream code reads from this exclusively — no raw argv or configJson
 * re-parsing past this point.
 */
export interface ResolvedConfig {
  /** Absolute path of the entry file or of an inferred `package.json`. */
  input: string;
  /** Real entrypoint: resolved `bin` target if input is a package.json-like
   *  file, otherwise `input`. */
  inputFin: string;
  /** Parsed package.json-like input (undefined for plain JS entries). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputJson: any;
  /** Absolute path of the loaded config file, if any. */
  config: string | undefined;
  /** Parsed (and normalized) config file contents, if any. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configJson: any;
  /**
   * Effective pkg config (configJson.pkg > inputJson.pkg > {}) with resolved
   * flag values written back in, so downstream consumers reading the pkg
   * (e.g. `pkgOptions.get()`) observe CLI overrides.
   */
  pkg: PkgOptions;
  /** Merged CLI > config > default build-shaping flags. */
  flags: ResolvedFlags;
  /** Force rebuilding base Node.js binaries from source. */
  forceBuild: boolean;
  /** Resolved single-output base path (absolute). */
  output: string;
  /** `true` when the output name was derived automatically. */
  autoOutput: boolean;
  /** Fully resolved targets with per-target output paths assigned. */
  targets: ResolvedTarget[];
}

/**
 * Orchestrate the full resolution pipeline: entry → config file → pkg validate
 * → flag merge → output path → targets. This is the single "understand what
 * the user asked for" step that `exec()` runs before any build work.
 */
export async function resolveConfig(
  parsed: ParsedInput,
): Promise<ResolvedConfig> {
  if (!parsed.entry) {
    throw wasReported('Entry file/directory is expected', [
      'Pass --help to see usage information',
    ]);
  }

  const { input, inputFin, inputJson, inputJsonName } = await resolveInput(
    parsed.entry,
  );
  const { config, configJson } = await resolveConfigFile(
    parsed.config,
    input,
    inputJson,
  );

  const sourcePkg = configJson?.pkg ?? inputJson?.pkg ?? {};
  if (
    typeof sourcePkg !== 'object' ||
    sourcePkg === null ||
    Array.isArray(sourcePkg)
  ) {
    throw wasReported('pkg config: "pkg" must be an object');
  }
  // Spread (not Object.assign) so configJson/inputJson stay untouched —
  // they're returned to the caller and other readers shouldn't observe
  // API-injected hooks bleeding back into the source `pkg` field.
  // Programmatic-API hook fields are layered on top of any config-file
  // hooks: the API call site is the most explicit.
  const rawPkg = { ...sourcePkg, ...(parsed.apiPkg ?? {}) };
  validatePkgConfig(rawPkg);
  const flags = resolveFlags(parsed.flags, rawPkg as PkgOptions);
  const pkg = applyResolvedFlags(rawPkg as PkgOptions, flags);

  const { output, autoOutput } = resolveOutput(
    parsed.output,
    parsed.outputPath,
    inputJson,
    inputJsonName,
    configJson,
    pkg,
    inputFin,
    parsed.entry,
  );

  const targets = assignTargetOutputs(
    resolveTargetList(parsed.targets, pkg, autoOutput),
    output,
    autoOutput,
    inputFin,
  );

  return {
    input,
    inputFin,
    inputJson,
    config,
    configJson,
    pkg,
    flags,
    forceBuild: parsed.build === true,
    output,
    autoOutput,
    targets,
  };
}
