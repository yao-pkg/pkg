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

// Auto-discovered config filenames, in precedence order. First match wins.
export const PKGRC_FILENAMES = [
  '.pkgrc',
  '.pkgrc.json',
  'pkg.config.js',
  'pkg.config.cjs',
  'pkg.config.mjs',
];

export function findPkgrc(baseDir: string): string | undefined {
  for (const name of PKGRC_FILENAMES) {
    const candidate = path.join(baseDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

// TypeScript with `module: commonjs` rewrites `import(...)` as `require(...)`,
// which breaks ESM loading. `new Function(...)` forces a genuine dynamic import.
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<{ default?: unknown; [k: string]: unknown }>;

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

export function isConfiguration(file: string): boolean {
  return isPackageJson(file) || file.endsWith('.config.json');
}

// ---------------------------------------------------------------------------
// Flag registry — single source of truth for every config-overridable flag.
// Each entry maps three coordinates: CLI name, config key, resolved key.
// `option` diverges from `cfg` only when the programmatic API uses a different
// name (legacy `options` vs `bakeOptions` skew).
// ---------------------------------------------------------------------------

type FlagKind = 'bool' | 'string' | 'list';

interface FlagSpec {
  readonly cli: string;
  readonly cfg: keyof PkgOptions;
  readonly option?: keyof PkgExecOptions;
  readonly resolved: keyof ResolvedFlags;
  readonly kind: FlagKind;
  readonly default?: boolean | string;
  readonly short?: string;
}

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

const optionKey = (s: FlagSpec): keyof PkgExecOptions =>
  (s.option ?? s.cfg) as keyof PkgExecOptions;

// ---------------------------------------------------------------------------
// CLI parsing (util.parseArgs-based)
// ---------------------------------------------------------------------------

type ParseArgsTokens = NonNullable<ReturnType<typeof parseArgs>['tokens']>;

// parseArgs types values as `string | boolean | (string | boolean)[] | undefined`
// to accommodate `multiple: true`, which pkg does not use. Narrowing at the
// boundary (see parseCliInput) lets every downstream read stay cast-free.
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

// parseArgs does NOT auto-generate `--no-<flag>` negations, so every negatable
// bool gets a `no-<flag>` sibling declared explicitly. `build` is CLI-only.
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

export type RawFlags = Record<string, string | boolean | undefined>;

export interface ParsedInput {
  help?: boolean;
  version?: boolean;
  entry?: string;
  config?: string;
  output?: string;
  outputPath?: string; // collapsed from --out-path / --outdir / --out-dir
  targets?: string;
  build?: boolean;
  flags: RawFlags;
}

// Collapse `no-<flag>: true` into `<flag>: false|true` so downstream reads a
// single canonical key. The token walk establishes last-wins order if both
// forms were passed (`--bytecode --no-bytecode`).
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

function joinList(v: string[] | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const joined = Array.isArray(v) ? v.join(',') : v;
  return joined === '' ? undefined : joined;
}

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
    // `target` (short -t) and `targets` accepted as aliases; collapse.
    targets: v.targets ?? v.target,
    build: v.build,
    flags,
  };
}

function parseOptionsInput(options: PkgExecOptions): ParsedInput {
  if (!options || typeof options !== 'object') {
    throw wasReported('exec() options must be an object');
  }
  if (!options.input || typeof options.input !== 'string') {
    throw wasReported('exec() options.input is required and must be a string');
  }

  const flags: RawFlags = {};
  for (const s of FLAG_SPECS) {
    const v = options[optionKey(s)];
    if (v === undefined) continue;
    if (s.kind === 'list') {
      // list fields are typed as string | string[]; guard boolean defensively.
      if (typeof v !== 'boolean') flags[s.cli] = joinList(v);
    } else if (typeof v === 'string' || typeof v === 'boolean') {
      flags[s.cli] = v;
    }
  }

  return {
    entry: options.input,
    config: options.config,
    output: options.output,
    outputPath: options.outputPath,
    targets: joinList(options.targets),
    build: options.build,
    flags,
  };
}

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
] as const;

const KNOWN_PKG_KEYS = new Set<string>([
  ...NON_FLAG_PKG_KEYS,
  ...FLAG_SPECS.map((s) => s.cfg),
]);

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
}

// ---------------------------------------------------------------------------
// Flag merge — CLI > pkg config > default. Fully resolved (compress → enum).
// ---------------------------------------------------------------------------

export interface ResolvedFlags {
  debug: boolean;
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

// Merge CLI (comma-joined string) and config (string or string[]) into a
// cleaned string[]. An empty-string CLI (`--options ""`) counts as "user
// explicitly cleared the list" — it wins over config but collapses to
// `undefined` so callers treat it the same as unset.
function toStringList(v: unknown): string | string[] | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
    return v as string[];
  }
  return undefined;
}

function resolveList(
  cli: string | undefined,
  cfg: string | string[] | undefined,
): string[] | undefined {
  const raw = cli !== undefined ? cli : cfg;
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : raw.split(',');
  const cleaned = list.map((s) => String(s).trim()).filter((s) => s.length);
  return cleaned.length ? cleaned : undefined;
}

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

export function resolveFlags(raw: RawFlags, pkg: PkgOptions): ResolvedFlags {
  validatePkgConfig(pkg);

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

// ---------------------------------------------------------------------------
// Phase helpers
// ---------------------------------------------------------------------------

interface ResolvedInput {
  input: string;
  inputFin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputJson: any;
  inputJsonName: string | undefined;
}

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

interface ResolvedConfigFile {
  config: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configJson: any;
}

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

function resolveOutput(
  cliOutput: string | undefined,
  cliOutputPath: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputJson: any,
  inputJsonName: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configJson: any,
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

  const outputPath =
    cliOutputPath ??
    (configJson?.pkg as PkgOptions | undefined)?.outputPath ??
    (inputJson?.pkg as PkgOptions | undefined)?.outputPath ??
    '';

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

const hostNodeRange = `node${process.version.match(/^v(\d+)/)![1]}`;

function parseTargets(items: string[]): NodeTarget[] {
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

export function stringifyTarget(t: NodeTarget): string {
  return `${t.nodeRange}-${t.platform}-${t.arch}`;
}

export interface DifferentParts {
  nodeRange?: boolean;
  platform?: boolean;
  arch?: boolean;
}

function differentParts(targets: NodeTarget[]): DifferentParts {
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

function stringifyTargetForOutput(
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

export type ResolvedTarget = NodeTarget & { output: string };

function resolveTargetList(
  cliTargets: string | undefined,
  pkg: PkgOptions,
  autoOutput: boolean,
): NodeTarget[] {
  let spec: string[] = [];
  if (cliTargets) {
    spec = cliTargets.split(',').filter(Boolean);
  } else if (pkg.targets) {
    spec = Array.isArray(pkg.targets)
      ? pkg.targets
      : String(pkg.targets).split(',').filter(Boolean);
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
  /** Effective pkg config (configJson.pkg > inputJson.pkg > {}). */
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

  const rawPkg = configJson?.pkg ?? inputJson?.pkg ?? {};
  if (typeof rawPkg !== 'object' || rawPkg === null || Array.isArray(rawPkg)) {
    throw wasReported('pkg config: "pkg" must be an object');
  }
  const pkg = rawPkg as PkgOptions;
  const flags = resolveFlags(parsed.flags, pkg);

  const { output, autoOutput } = resolveOutput(
    parsed.output,
    parsed.outputPath,
    inputJson,
    inputJsonName,
    configJson,
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
