import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { CompressType } from '../../lib/compress_type';
import { log } from '../../lib/log';
import { parseInput, resolveFlags, validatePkgConfig } from '../../lib/config';

type LogFn = (..._a: unknown[]) => void;

// validatePkgConfig calls log.warn; wasReported() (used elsewhere) calls
// log.error before returning an Error. Capture the former for assertions,
// silence the latter so assertion-triggered throws don't pollute output.
let warned: string[];
let infoed: string[];
let originals: { warn: LogFn; info: LogFn; error: LogFn };

beforeEach(() => {
  warned = [];
  infoed = [];
  originals = {
    warn: log.warn as LogFn,
    info: log.info as LogFn,
    error: log.error as LogFn,
  };
  log.warn = ((...a: unknown[]) => {
    warned.push(a.join(' '));
  }) as typeof log.warn;
  log.info = ((...a: unknown[]) => {
    infoed.push(a.join(' '));
  }) as typeof log.info;
  log.error = (() => {}) as typeof log.error;
});

afterEach(() => {
  log.warn = originals.warn as typeof log.warn;
  log.info = originals.info as typeof log.info;
  log.error = originals.error as typeof log.error;
});

describe('parseInput — CLI argv', () => {
  describe('positional handling', () => {
    it('single positional becomes entry', () => {
      assert.equal(parseInput(['app.js']).entry, 'app.js');
    });

    it('zero positionals → entry undefined (help/version path)', () => {
      const p = parseInput(['--help']);
      assert.equal(p.entry, undefined);
      assert.equal(p.help, true);
    });

    it('multiple positionals throws', () => {
      assert.throws(
        () => parseInput(['a.js', 'b.js']),
        /Not more than one entry/,
      );
    });
  });

  describe('short-circuits', () => {
    it('-h is short for --help', () => {
      assert.equal(parseInput(['-h']).help, true);
    });

    it('-v is short for --version', () => {
      assert.equal(parseInput(['-v']).version, true);
    });
  });

  describe('non-flag strings', () => {
    it('--config / -c', () => {
      assert.equal(parseInput(['-c', 'cfg.json', 'a.js']).config, 'cfg.json');
    });

    it('--output / -o', () => {
      assert.equal(parseInput(['-o', 'bin', 'a.js']).output, 'bin');
    });

    it('--target aliased to targets', () => {
      assert.equal(parseInput(['--target', 'host', 'a.js']).targets, 'host');
    });

    it('--targets canonical name', () => {
      assert.equal(
        parseInput(['--targets', 'node22-linux-x64', 'a.js']).targets,
        'node22-linux-x64',
      );
    });

    it('-t is short for --target', () => {
      assert.equal(parseInput(['-t', 'host', 'a.js']).targets, 'host');
    });

    it('--out-path / --outdir / --out-dir all collapse to outputPath', () => {
      assert.equal(parseInput(['--out-path', '/o', 'a.js']).outputPath, '/o');
      assert.equal(parseInput(['--outdir', '/o', 'a.js']).outputPath, '/o');
      assert.equal(parseInput(['--out-dir', '/o', 'a.js']).outputPath, '/o');
    });

    it('--build / -b', () => {
      assert.equal(parseInput(['-b', 'a.js']).build, true);
    });

    it('--no-build (build is CLI-only negatable)', () => {
      assert.equal(parseInput(['--no-build', 'a.js']).build, false);
    });
  });

  describe('flag kinds', () => {
    it('bool flag --debug', () => {
      assert.equal(parseInput(['--debug', 'a.js']).flags.debug, true);
    });

    it('-d is short for --debug', () => {
      assert.equal(parseInput(['-d', 'a.js']).flags.debug, true);
    });

    it('string flag --compress Brotli', () => {
      assert.equal(
        parseInput(['--compress', 'Brotli', 'a.js']).flags.compress,
        'Brotli',
      );
    });

    it('-C is short for --compress', () => {
      assert.equal(parseInput(['-C', 'GZip', 'a.js']).flags.compress, 'GZip');
    });

    it('list flag --options (csv stored raw)', () => {
      assert.equal(
        parseInput(['--options', 'expose-gc,use-strict', 'a.js']).flags.options,
        'expose-gc,use-strict',
      );
    });

    it('list flag --public-packages (kebab key preserved)', () => {
      assert.equal(
        parseInput(['--public-packages', '*', 'a.js']).flags['public-packages'],
        '*',
      );
    });

    it('list flag --no-dict (kebab key preserved)', () => {
      assert.equal(
        parseInput(['--no-dict', 'lodash', 'a.js']).flags['no-dict'],
        'lodash',
      );
    });

    it('--options "" preserves the explicit empty signal', () => {
      assert.equal(parseInput(['--options', '', 'a.js']).flags.options, '');
    });
  });

  describe('negation', () => {
    it('--no-bytecode → bytecode=false', () => {
      assert.equal(parseInput(['--no-bytecode', 'a.js']).flags.bytecode, false);
    });

    it('--bytecode --no-bytecode → last wins (false)', () => {
      assert.equal(
        parseInput(['--bytecode', '--no-bytecode', 'a.js']).flags.bytecode,
        false,
      );
    });

    it('--no-bytecode --bytecode → last wins (true)', () => {
      assert.equal(
        parseInput(['--no-bytecode', '--bytecode', 'a.js']).flags.bytecode,
        true,
      );
    });

    for (const flag of [
      'debug',
      'bytecode',
      'native-build',
      'signature',
      'fallback-to-source',
      'public',
      'sea',
    ]) {
      it(`--no-${flag} sets flag to false`, () => {
        assert.equal(parseInput([`--no-${flag}`, 'a.js']).flags[flag], false);
      });
    }
  });

  describe('error paths', () => {
    it('unknown option throws', () => {
      assert.throws(
        () => parseInput(['--not-a-thing', 'a.js']),
        /Unknown option/i,
      );
    });

    it('--compress followed by a flag-looking token is ambiguous', () => {
      assert.throws(
        () => parseInput(['--compress', '--', 'a.js']),
        /ambiguous|missing/i,
      );
    });
  });
});

describe('parseInput — PkgExecOptions', () => {
  it('null throws', () => {
    assert.throws(
      () => parseInput(null as unknown as Parameters<typeof parseInput>[0]),
      /options must be an object/,
    );
  });

  it('non-object throws', () => {
    assert.throws(
      () => parseInput('oops' as unknown as Parameters<typeof parseInput>[0]),
      /options must be an object/,
    );
  });

  it('missing input throws', () => {
    assert.throws(
      () => parseInput({} as Parameters<typeof parseInput>[0]),
      /options\.input is required/,
    );
  });

  it('non-string input throws', () => {
    assert.throws(
      () =>
        parseInput({ input: 42 } as unknown as Parameters<
          typeof parseInput
        >[0]),
      /options\.input is required/,
    );
  });

  it('minimum viable options', () => {
    const p = parseInput({ input: 'a.js' });
    assert.equal(p.entry, 'a.js');
    assert.deepEqual(p.flags, {});
  });

  it('bool flags round-trip', () => {
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
    assert.equal(p.flags.debug, true);
    assert.equal(p.flags.bytecode, false);
    assert.equal(p.flags.public, true);
    assert.equal(p.flags.sea, true);
    assert.equal(p.flags.signature, false);
    assert.equal(p.flags['native-build'], false);
    assert.equal(p.flags['fallback-to-source'], true);
  });

  it('compress string passes through', () => {
    assert.equal(
      parseInput({ input: 'a.js', compress: 'Brotli' }).flags.compress,
      'Brotli',
    );
  });

  it('bakeOptions array joins to csv under "options"', () => {
    assert.equal(
      parseInput({
        input: 'a.js',
        bakeOptions: ['expose-gc', 'use-strict'],
      }).flags.options,
      'expose-gc,use-strict',
    );
  });

  it('bakeOptions scalar passes through', () => {
    assert.equal(
      parseInput({ input: 'a.js', bakeOptions: 'expose-gc' }).flags.options,
      'expose-gc',
    );
  });

  it('empty bakeOptions array → not set', () => {
    assert.equal(
      parseInput({ input: 'a.js', bakeOptions: [] }).flags.options,
      undefined,
    );
  });

  it('publicPackages array joins under "public-packages"', () => {
    assert.equal(
      parseInput({ input: 'a.js', publicPackages: ['*'] }).flags[
        'public-packages'
      ],
      '*',
    );
  });

  it('noDictionary array joins under "no-dict"', () => {
    assert.equal(
      parseInput({ input: 'a.js', noDictionary: ['lodash', 'chalk'] }).flags[
        'no-dict'
      ],
      'lodash,chalk',
    );
  });

  it('targets array joins', () => {
    assert.equal(
      parseInput({
        input: 'a.js',
        targets: ['node22-linux', 'node22-macos'],
      }).targets,
      'node22-linux,node22-macos',
    );
  });

  it('output + outputPath + config + build round-trip', () => {
    const p = parseInput({
      input: 'a.js',
      output: 'bin',
      outputPath: '/dist',
      config: 'cfg.json',
      build: true,
    });
    assert.equal(p.output, 'bin');
    assert.equal(p.outputPath, '/dist');
    assert.equal(p.config, 'cfg.json');
    assert.equal(p.build, true);
  });

  it('unset fields do not appear in flags', () => {
    const p = parseInput({ input: 'a.js' });
    assert.equal(p.flags.debug, undefined);
    assert.equal(p.flags.bytecode, undefined);
    assert.equal(p.flags.compress, undefined);
  });
});

describe('resolveFlags — CLI > config > default', () => {
  it('all defaults when raw + pkg are empty', () => {
    const f = resolveFlags({}, {});
    assert.equal(f.debug, false);
    assert.equal(f.bytecode, true);
    assert.equal(f.nativeBuild, true);
    assert.equal(f.signature, true);
    assert.equal(f.public, false);
    assert.equal(f.sea, false);
    assert.equal(f.fallbackToSource, false);
    assert.equal(f.compress, CompressType.None);
    assert.equal(f.bakeOptions, undefined);
    assert.equal(f.publicPackages, undefined);
    assert.equal(f.noDictionary, undefined);
  });

  it('config wins when CLI is absent', () => {
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
    assert.equal(f.bytecode, false);
    assert.equal(f.public, true);
    assert.equal(f.debug, true);
    assert.equal(f.compress, CompressType.GZip);
    assert.equal(f.fallbackToSource, true);
    assert.equal(f.signature, false);
  });

  it('CLI overrides config', () => {
    const f = resolveFlags(
      { bytecode: true, compress: 'None', public: false },
      { bytecode: false, compress: 'Brotli', public: true },
    );
    assert.equal(f.bytecode, true);
    assert.equal(f.compress, CompressType.None);
    assert.equal(f.public, false);
  });

  it('CLI false overrides config true (three-state)', () => {
    // Three-state is critical for negation: --no-bytecode must beat
    // cfg.bytecode=true.
    const f = resolveFlags({ bytecode: false }, { bytecode: true });
    assert.equal(f.bytecode, false);
  });

  describe('list handling', () => {
    it('CLI "" clears the configured list (empty wins)', () => {
      const f = resolveFlags({ options: '' }, { options: ['expose-gc'] });
      assert.equal(f.bakeOptions, undefined);
    });

    it('CLI csv parses into a cleaned array', () => {
      const f = resolveFlags({ 'public-packages': 'a, b , c' }, {});
      assert.deepEqual(f.publicPackages, ['a', 'b', 'c']);
    });

    it('config array cleaned', () => {
      const f = resolveFlags({}, { options: ['expose-gc', ' use-strict '] });
      assert.deepEqual(f.bakeOptions, ['expose-gc', 'use-strict']);
    });

    it('config string (comma) normalized', () => {
      const f = resolveFlags({}, { publicPackages: 'x,y,z' });
      assert.deepEqual(f.publicPackages, ['x', 'y', 'z']);
    });

    it('list with only whitespace/empty → undefined', () => {
      const f = resolveFlags({ 'no-dict': '  ,  , ' }, {});
      assert.equal(f.noDictionary, undefined);
    });

    it('"*" is preserved', () => {
      const f = resolveFlags({}, { publicPackages: ['*'] });
      assert.deepEqual(f.publicPackages, ['*']);
    });
  });

  describe('compress decoding', () => {
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
    ] as const) {
      it(`"${input}" → CompressType.${CompressType[expected]}`, () => {
        const f = resolveFlags({ compress: input }, {});
        assert.equal(f.compress, expected);
      });
    }

    it('invalid value throws', () => {
      assert.throws(
        () => resolveFlags({ compress: 'lz4' }, {}),
        /Invalid compression/,
      );
    });

    it('empty string throws', () => {
      assert.throws(
        () => resolveFlags({ compress: '' }, {}),
        /Invalid compression/,
      );
    });
  });
});

describe('validatePkgConfig', () => {
  it('undefined is a no-op', () => {
    validatePkgConfig(undefined);
    assert.equal(warned.length, 0);
  });

  it('empty object is a no-op', () => {
    validatePkgConfig({});
    assert.equal(warned.length, 0);
  });

  it('unknown key warns (does not throw)', () => {
    validatePkgConfig({ totallyMadeUp: 1 });
    assert.ok(
      warned.some((w) => /totallyMadeUp/.test(w)),
      `got: ${warned.join('|')}`,
    );
  });

  it('all known non-flag keys accepted silently', () => {
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
    assert.equal(warned.length, 0, `unexpected warns: ${warned.join('|')}`);
  });

  it('all FLAG_SPECS keys accepted silently with correct types', () => {
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
    assert.equal(warned.length, 0, `unexpected warns: ${warned.join('|')}`);
  });

  it('bool with string throws', () => {
    assert.throws(
      () => validatePkgConfig({ bytecode: 'yes' }),
      /"bytecode" must be a boolean/,
    );
  });

  it('bool with number throws', () => {
    assert.throws(
      () => validatePkgConfig({ debug: 1 }),
      /"debug" must be a boolean/,
    );
  });

  it('string with bool throws', () => {
    assert.throws(
      () => validatePkgConfig({ compress: true }),
      /"compress" must be a string/,
    );
  });

  it('list with number throws', () => {
    assert.throws(
      () => validatePkgConfig({ publicPackages: 42 }),
      /"publicPackages" must be a string or string/,
    );
  });

  it('list with mixed array throws', () => {
    assert.throws(
      () => validatePkgConfig({ options: ['ok', 42] }),
      /"options" must be a string or string/,
    );
  });

  it('list with string OK', () => {
    validatePkgConfig({ publicPackages: 'a,b' });
  });

  it('list with string[] OK', () => {
    validatePkgConfig({ publicPackages: ['a', 'b'] });
  });
});
