#!/usr/bin/env node

'use strict';

// Pure-unit regression guard for lib/config.ts.
//
// Covers the full CLI + programmatic parsing surface: parseInput,
// resolveFlags, validatePkgConfig. Does NOT build binaries — it requires
// lib-es5 directly and asserts behavior in-process.
//
// Runs in ~50ms, so it catches config/CLI regressions long before the
// integration tests (test-50-config-flags/ etc.) would.

const assert = require('assert');

const { CompressType } = require('../../lib-es5/compress_type.js');
const { log } = require('../../lib-es5/log.js');
const {
  parseInput,
  resolveFlags,
  validatePkgConfig,
} = require('../../lib-es5/config.js');

// --- harness --------------------------------------------------------------

const failures = [];
let passed = 0;

const originalWarn = log.warn;
const originalInfo = log.info;
const originalError = log.error;
let warned = [];
let infoed = [];
log.warn = (...a) => {
  warned.push(a.join(' '));
};
log.info = (...a) => {
  infoed.push(a.join(' '));
};
// wasReported() logs via log.error before returning the Error we throw.
// Silence it so assertion-triggered throws don't pollute test output.
log.error = () => {};

function t(name, fn) {
  warned = [];
  infoed = [];
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push({ name, err: e });
  }
}

function throwsWith(fn, re, label) {
  try {
    fn();
  } catch (e) {
    if (!re.test(e.message)) {
      throw new Error(
        `${label || 'throw'}: expected /${re.source}/, got: ${e.message}`,
      );
    }
    return;
  }
  throw new Error(
    `${label || 'throw'}: expected throw matching /${re.source}/`,
  );
}

// =========================================================================
// CLI parseInput
// =========================================================================

// --- positional handling

t('cli: single positional becomes entry', () => {
  const p = parseInput(['app.js']);
  assert.strictEqual(p.entry, 'app.js');
});

t('cli: zero positionals → entry undefined (help/version path)', () => {
  const p = parseInput(['--help']);
  assert.strictEqual(p.entry, undefined);
  assert.strictEqual(p.help, true);
});

t('cli: multiple positionals throws', () => {
  throwsWith(() => parseInput(['a.js', 'b.js']), /Not more than one entry/);
});

// --- short-circuits

t('cli: -h short for --help', () => {
  assert.strictEqual(parseInput(['-h']).help, true);
});

t('cli: -v short for --version', () => {
  assert.strictEqual(parseInput(['-v']).version, true);
});

// --- non-flag strings (config, output, targets, build)

t('cli: --config short -c', () => {
  assert.strictEqual(parseInput(['-c', 'cfg.json', 'a.js']).config, 'cfg.json');
});

t('cli: --output short -o', () => {
  assert.strictEqual(parseInput(['-o', 'bin', 'a.js']).output, 'bin');
});

t('cli: --target aliased to targets', () => {
  assert.strictEqual(parseInput(['--target', 'host', 'a.js']).targets, 'host');
});

t('cli: --targets canonical name', () => {
  assert.strictEqual(
    parseInput(['--targets', 'node22-linux-x64', 'a.js']).targets,
    'node22-linux-x64',
  );
});

t('cli: -t short for --target', () => {
  assert.strictEqual(parseInput(['-t', 'host', 'a.js']).targets, 'host');
});

t('cli: --out-path / --outdir / --out-dir collapse to outputPath', () => {
  assert.strictEqual(parseInput(['--out-path', '/o', 'a.js']).outputPath, '/o');
  assert.strictEqual(parseInput(['--outdir', '/o', 'a.js']).outputPath, '/o');
  assert.strictEqual(parseInput(['--out-dir', '/o', 'a.js']).outputPath, '/o');
});

t('cli: --build short -b', () => {
  assert.strictEqual(parseInput(['-b', 'a.js']).build, true);
});

t('cli: --no-build (build is CLI-only negatable)', () => {
  assert.strictEqual(parseInput(['--no-build', 'a.js']).build, false);
});

// --- flag kinds

t('cli: bool flag (--debug)', () => {
  assert.strictEqual(parseInput(['--debug', 'a.js']).flags.debug, true);
});

t('cli: -d short for --debug', () => {
  assert.strictEqual(parseInput(['-d', 'a.js']).flags.debug, true);
});

t('cli: string flag (--compress Brotli)', () => {
  assert.strictEqual(
    parseInput(['--compress', 'Brotli', 'a.js']).flags.compress,
    'Brotli',
  );
});

t('cli: -C short for --compress', () => {
  assert.strictEqual(parseInput(['-C', 'GZip', 'a.js']).flags.compress, 'GZip');
});

t('cli: list flag (--options csv stored raw)', () => {
  assert.strictEqual(
    parseInput(['--options', 'expose-gc,use-strict', 'a.js']).flags.options,
    'expose-gc,use-strict',
  );
});

t('cli: list flag (--public-packages, kebab preserved in raw key)', () => {
  const p = parseInput(['--public-packages', '*', 'a.js']);
  assert.strictEqual(p.flags['public-packages'], '*');
});

t('cli: list flag (--no-dict, kebab preserved)', () => {
  const p = parseInput(['--no-dict', 'lodash', 'a.js']);
  assert.strictEqual(p.flags['no-dict'], 'lodash');
});

t('cli: --options "" (explicit empty — clear signal preserved)', () => {
  assert.strictEqual(parseInput(['--options', '', 'a.js']).flags.options, '');
});

// --- negation

t('cli: --no-bytecode → bytecode=false', () => {
  assert.strictEqual(
    parseInput(['--no-bytecode', 'a.js']).flags.bytecode,
    false,
  );
});

t('cli: --bytecode --no-bytecode (neg last wins)', () => {
  assert.strictEqual(
    parseInput(['--bytecode', '--no-bytecode', 'a.js']).flags.bytecode,
    false,
  );
});

t('cli: --no-bytecode --bytecode (pos last wins)', () => {
  assert.strictEqual(
    parseInput(['--no-bytecode', '--bytecode', 'a.js']).flags.bytecode,
    true,
  );
});

t('cli: negation for every FLAG_SPECS bool', () => {
  for (const flag of [
    'debug',
    'bytecode',
    'native-build',
    'signature',
    'fallback-to-source',
    'public',
    'sea',
  ]) {
    const p = parseInput([`--no-${flag}`, 'a.js']);
    assert.strictEqual(p.flags[flag], false, `--no-${flag} should set false`);
  }
});

// --- error paths

t('cli: unknown option throws', () => {
  throwsWith(() => parseInput(['--not-a-thing', 'a.js']), /Unknown option/i);
});

t('cli: --compress followed by a flag-looking token is ambiguous', () => {
  throwsWith(
    () => parseInput(['--compress', '--', 'a.js']),
    /ambiguous|missing/i,
  );
});

// =========================================================================
// Programmatic parseInput (PkgExecOptions)
// =========================================================================

t('opts: null throws', () => {
  throwsWith(() => parseInput(null), /options must be an object/);
});

t('opts: non-object throws', () => {
  throwsWith(() => parseInput('oops'), /options must be an object/);
});

t('opts: missing input throws', () => {
  throwsWith(() => parseInput({}), /options.input is required/);
});

t('opts: non-string input throws', () => {
  throwsWith(() => parseInput({ input: 42 }), /options.input is required/);
});

t('opts: minimum viable', () => {
  const p = parseInput({ input: 'a.js' });
  assert.strictEqual(p.entry, 'a.js');
  assert.deepStrictEqual(p.flags, {});
});

t('opts: bool flags round-trip', () => {
  const p = parseInput({
    input: 'a.js',
    debug: true,
    bytecode: false,
    public: true,
    sea: true,
    signature: false,
    nativeBuild: false,
    fallbackToSource: true,
  });
  assert.strictEqual(p.flags.debug, true);
  assert.strictEqual(p.flags.bytecode, false);
  assert.strictEqual(p.flags.public, true);
  assert.strictEqual(p.flags.sea, true);
  assert.strictEqual(p.flags.signature, false);
  assert.strictEqual(p.flags['native-build'], false);
  assert.strictEqual(p.flags['fallback-to-source'], true);
});

t('opts: compress string passes through', () => {
  assert.strictEqual(
    parseInput({ input: 'a.js', compress: 'Brotli' }).flags.compress,
    'Brotli',
  );
});

t('opts: bakeOptions array joins to csv under "options" key', () => {
  const p = parseInput({
    input: 'a.js',
    bakeOptions: ['expose-gc', 'use-strict'],
  });
  assert.strictEqual(p.flags.options, 'expose-gc,use-strict');
});

t('opts: bakeOptions scalar passes through', () => {
  const p = parseInput({ input: 'a.js', bakeOptions: 'expose-gc' });
  assert.strictEqual(p.flags.options, 'expose-gc');
});

t('opts: empty bakeOptions array → not set', () => {
  const p = parseInput({ input: 'a.js', bakeOptions: [] });
  assert.strictEqual(p.flags.options, undefined);
});

t('opts: publicPackages array joins under "public-packages"', () => {
  const p = parseInput({ input: 'a.js', publicPackages: ['*'] });
  assert.strictEqual(p.flags['public-packages'], '*');
});

t('opts: noDictionary array joins under "no-dict"', () => {
  const p = parseInput({ input: 'a.js', noDictionary: ['lodash', 'chalk'] });
  assert.strictEqual(p.flags['no-dict'], 'lodash,chalk');
});

t('opts: targets array joins', () => {
  const p = parseInput({
    input: 'a.js',
    targets: ['node22-linux', 'node22-macos'],
  });
  assert.strictEqual(p.targets, 'node22-linux,node22-macos');
});

t('opts: output + outputPath round-trip', () => {
  const p = parseInput({
    input: 'a.js',
    output: 'bin',
    outputPath: '/dist',
    config: 'cfg.json',
    build: true,
  });
  assert.strictEqual(p.output, 'bin');
  assert.strictEqual(p.outputPath, '/dist');
  assert.strictEqual(p.config, 'cfg.json');
  assert.strictEqual(p.build, true);
});

t('opts: unset fields do not appear in flags', () => {
  const p = parseInput({ input: 'a.js' });
  assert.strictEqual(p.flags.debug, undefined);
  assert.strictEqual(p.flags.bytecode, undefined);
  assert.strictEqual(p.flags.compress, undefined);
});

// =========================================================================
// resolveFlags — CLI > config > default merge
// =========================================================================

t('resolve: all defaults', () => {
  const f = resolveFlags({}, {});
  assert.strictEqual(f.debug, false);
  assert.strictEqual(f.bytecode, true);
  assert.strictEqual(f.nativeBuild, true);
  assert.strictEqual(f.signature, true);
  assert.strictEqual(f.public, false);
  assert.strictEqual(f.sea, false);
  assert.strictEqual(f.fallbackToSource, false);
  assert.strictEqual(f.compress, CompressType.None);
  assert.strictEqual(f.bakeOptions, undefined);
  assert.strictEqual(f.publicPackages, undefined);
  assert.strictEqual(f.noDictionary, undefined);
});

t('resolve: config wins when CLI absent', () => {
  const f = resolveFlags(
    {},
    {
      bytecode: false,
      public: true,
      debug: true,
      compress: 'GZip',
      fallbackToSource: true,
      signature: false,
    },
  );
  assert.strictEqual(f.bytecode, false);
  assert.strictEqual(f.public, true);
  assert.strictEqual(f.debug, true);
  assert.strictEqual(f.compress, CompressType.GZip);
  assert.strictEqual(f.fallbackToSource, true);
  assert.strictEqual(f.signature, false);
});

t('resolve: CLI overrides config', () => {
  const f = resolveFlags(
    { bytecode: true, compress: 'None', public: false },
    { bytecode: false, compress: 'Brotli', public: true },
  );
  assert.strictEqual(f.bytecode, true);
  assert.strictEqual(f.compress, CompressType.None);
  assert.strictEqual(f.public, false);
});

t('resolve: CLI false overrides config true (three-state)', () => {
  // Three-state is critical for negation: --no-bytecode must beat cfg.bytecode=true
  const f = resolveFlags({ bytecode: false }, { bytecode: true });
  assert.strictEqual(f.bytecode, false);
});

// --- list handling

t('resolve: list CLI "" clears configured list (empty wins)', () => {
  const f = resolveFlags({ options: '' }, { options: ['expose-gc'] });
  assert.strictEqual(f.bakeOptions, undefined);
});

t('resolve: list CLI csv parses into cleaned array', () => {
  const f = resolveFlags({ 'public-packages': 'a, b , c' }, {});
  assert.deepStrictEqual(f.publicPackages, ['a', 'b', 'c']);
});

t('resolve: list config array cleaned', () => {
  const f = resolveFlags({}, { options: ['expose-gc', ' use-strict '] });
  assert.deepStrictEqual(f.bakeOptions, ['expose-gc', 'use-strict']);
});

t('resolve: list config string (comma) normalized', () => {
  const f = resolveFlags({}, { publicPackages: 'x,y,z' });
  assert.deepStrictEqual(f.publicPackages, ['x', 'y', 'z']);
});

t('resolve: list with only whitespace/empty → undefined', () => {
  const f = resolveFlags({ 'no-dict': '  ,  , ' }, {});
  assert.strictEqual(f.noDictionary, undefined);
});

t('resolve: list with "*" preserved', () => {
  const f = resolveFlags({}, { publicPackages: ['*'] });
  assert.deepStrictEqual(f.publicPackages, ['*']);
});

// --- compress

for (const [input, expected] of [
  ['None', CompressType.None],
  ['none', CompressType.None],
  ['Brotli', CompressType.Brotli],
  ['br', CompressType.Brotli],
  ['brotli', CompressType.Brotli],
  ['BROTLI', CompressType.Brotli],
  ['GZip', CompressType.GZip],
  ['gz', CompressType.GZip],
  ['gzip', CompressType.GZip],
  ['Zstd', CompressType.Zstd],
  ['zs', CompressType.Zstd],
  ['zstd', CompressType.Zstd],
]) {
  t(`compress: "${input}" → CompressType.${CompressType[expected]}`, () => {
    const f = resolveFlags({ compress: input }, {});
    assert.strictEqual(f.compress, expected);
  });
}

t('compress: invalid value throws', () => {
  throwsWith(
    () => resolveFlags({ compress: 'lz4' }, {}),
    /Invalid compression/,
  );
});

t('compress: empty string throws', () => {
  throwsWith(() => resolveFlags({ compress: '' }, {}), /Invalid compression/);
});

// =========================================================================
// validatePkgConfig
// =========================================================================

t('validate: undefined is no-op', () => {
  validatePkgConfig(undefined);
  assert.strictEqual(warned.length, 0);
});

t('validate: empty object is no-op', () => {
  validatePkgConfig({});
  assert.strictEqual(warned.length, 0);
});

t('validate: unknown key warns (does not throw)', () => {
  validatePkgConfig({ totallyMadeUp: 1 });
  assert(
    warned.some((w) => /totallyMadeUp/.test(w)),
    `got: ${warned.join('|')}`,
  );
});

t('validate: all known non-flag keys accepted silently', () => {
  validatePkgConfig({
    scripts: [],
    assets: [],
    ignore: [],
    patches: {},
    deployFiles: [],
    dictionary: {},
    log: null,
    targets: [],
    outputPath: '',
    seaConfig: {},
  });
  assert.strictEqual(warned.length, 0, `unexpected warns: ${warned.join('|')}`);
});

t('validate: all FLAG_SPECS keys accepted silently with correct types', () => {
  validatePkgConfig({
    debug: true,
    bytecode: false,
    nativeBuild: true,
    signature: false,
    fallbackToSource: true,
    public: true,
    sea: false,
    compress: 'GZip',
    options: ['a'],
    publicPackages: 'x,y',
    noDictionary: ['*'],
  });
  assert.strictEqual(warned.length, 0, `unexpected warns: ${warned.join('|')}`);
});

// type errors
t('validate: bool with string throws', () => {
  throwsWith(
    () => validatePkgConfig({ bytecode: 'yes' }),
    /"bytecode" must be a boolean/,
  );
});

t('validate: bool with number throws', () => {
  throwsWith(
    () => validatePkgConfig({ debug: 1 }),
    /"debug" must be a boolean/,
  );
});

t('validate: string with bool throws', () => {
  throwsWith(
    () => validatePkgConfig({ compress: true }),
    /"compress" must be a string/,
  );
});

t('validate: list with number throws', () => {
  throwsWith(
    () => validatePkgConfig({ publicPackages: 42 }),
    /"publicPackages" must be a string or string/,
  );
});

t('validate: list with mixed array throws', () => {
  throwsWith(
    () => validatePkgConfig({ options: ['ok', 42] }),
    /"options" must be a string or string/,
  );
});

t('validate: list with string OK', () => {
  validatePkgConfig({ publicPackages: 'a,b' });
});

t('validate: list with string[] OK', () => {
  validatePkgConfig({ publicPackages: ['a', 'b'] });
});

// =========================================================================
// report
// =========================================================================

log.warn = originalWarn;
log.info = originalInfo;
log.error = originalError;

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):\n`);
  for (const { name, err } of failures) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}

console.log(`config parser: ${passed} assertions passed`);
