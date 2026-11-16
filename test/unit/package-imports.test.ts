import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { imports as resolveExportsImports } from 'resolve.exports';

import { resolvePackageImport } from '../../lib/resolver';

const shared = createRequire(__filename)('../../prelude/bootstrap-shared.js');
const resolveImportsTargets = shared.resolveImportsTargets as (
  _imports: Record<string, unknown>,
  _request: string,
) => { key: string; targets: string[] } | null;

// package.json "imports" are resolved twice: by resolvePackageImport() when
// packaging and by resolveImportsTargets() in the packaged binary.
// test-54-package-json-imports covers the common cases end to end.

describe('resolvePackageImport', () => {
  let root: string;

  /** Writes files below the temp dir, objects as JSON */
  function write(files: Record<string, unknown>) {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(root, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(
        full,
        typeof content === 'string' ? content : JSON.stringify(content),
      );
    }
  }

  before(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-imports-')),
    );
    write({
      'app/package.json': {
        name: 'app',
        imports: {
          '#file': './lib/file.js',
          '#esm-only': { import: './lib/file.js' },
          '#both': { require: './lib/file.js', import: './lib/other.js' },
          '#array': ['./lib/missing.js', './lib/other.js'],
          '#bare': 'some-package',
          '#builtin': 'fs',
          '#loop': '#file',
          '#gone': './lib/missing.js',
          '#browser': { browser: './lib/file.js' },
        },
      },
      'app/lib/file.js': '',
      'app/lib/other.js': '',
      'app/lib/deep/index.js': '',
      'app/scope/package.json': { imports: { '#file': './own.js' } },
      'app/scope/own.js': '',
      'broken/package.json': '{ "imports": ',
      'broken/index.js': '',
    });
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const app = (...parts: string[]) => path.join(root, 'app', ...parts);

  it('resolves a file target and returns the declaring package.json', () => {
    const result = resolvePackageImport('#file', app('lib'));
    assert.equal(result.kind, 'file');
    assert.equal(result.target, app('lib', 'file.js'));
    assert.equal(result.packageJson, app('package.json'));
    assert.equal(result.config.name, 'app');
  });

  it('uses the nearest package.json only', () => {
    assert.equal(
      resolvePackageImport('#file', app('lib', 'deep')).target,
      app('lib', 'file.js'),
    );

    const scoped = resolvePackageImport('#file', app('scope'));
    assert.equal(scoped.target, app('scope', 'own.js'));
    assert.equal(scoped.packageJson, app('scope', 'package.json'));

    // defined in the parent scope, but not in the nearest one
    assert.throws(
      () => resolvePackageImport('#bare', app('scope')),
      /not defined in "imports"/,
    );
  });

  it('prefers the require condition and falls back to import', () => {
    assert.equal(
      resolvePackageImport('#both', app()).target,
      app('lib', 'file.js'),
    );
    assert.equal(
      resolvePackageImport('#esm-only', app()).target,
      app('lib', 'file.js'),
    );
  });

  it('takes the first array target that exists', () => {
    assert.equal(
      resolvePackageImport('#array', app()).target,
      app('lib', 'other.js'),
    );
  });

  it('returns bare and builtin targets unresolved', () => {
    const bare = resolvePackageImport('#bare', app());
    assert.equal(bare.kind, 'bare');
    assert.equal(bare.target, 'some-package');

    const builtin = resolvePackageImport('#builtin', app());
    assert.equal(builtin.kind, 'builtin');
    assert.equal(builtin.target, 'fs');
  });

  it('names the reason when the specifier cannot be resolved', () => {
    const cases: [string, string, RegExp][] = [
      ['#nope', app(), /'#nope' from .*: not defined in "imports" of .*app/],
      ['#browser', app(), /not defined in "imports"/],
      ['#gone', app(), /no usable target in "imports" of .*missing\.js/],
      ['#loop', app(), /no usable target in "imports" of .*#file/],
      ['#file', path.join(root, 'broken'), /cannot read .*broken/],
    ];
    for (const [specifier, basedir, message] of cases) {
      assert.throws(() => resolvePackageImport(specifier, basedir), message);
    }
  });
});

describe('resolveImportsTargets (runtime)', () => {
  const imports = {
    '#exact': './exact.js',
    '#dir/exact': './dir-exact.js',
    '#dir/*': './dir/*.js',
    '#tie/*': './tie-short/*',
    '#tie/*.js': './tie-long/*.js',
    '#late/*.js': './late-long/*.js',
    '#late/*': './late-short/*',
    '#same/*x': './same-first/*',
    '#same/x*': './same-last/*',
    '#legacy/': './legacy/',
    '#fixed/*': './fixed.js',
    '#cond': { node: './node.js', default: './default.js' },
    '#require': { require: './cjs.js', import: './esm.js' },
    '#import': { import: './esm.js' },
    '#nested': { node: { import: './esm.js' }, default: './default.js' },
    '#array': ['./a.js', { browser: './browser.js' }, ['./b.js', './a.js']],
    '#browser': { browser: './browser.js' },
    '#bare': 'some-package',
    '#null': null,
  };

  const requests = [
    '#exact',
    '#dir/exact',
    '#dir/other',
    '#dir/deep/file',
    '#dir/',
    '#tie/value.js',
    '#tie/value.ts',
    '#late/value.js',
    '#same/xx',
    '#legacy/file.js',
    '#fixed/anything',
    '#cond',
    '#require',
    '#import',
    '#nested',
    '#array',
    '#browser',
    '#bare',
    '#null',
    '#unknown',
  ];

  // Not compared: keys with more than one `*`. Node.js doesn't treat them as
  // patterns and neither does the runtime, resolve.exports matches some.

  /** What resolvePackageImport() gets from resolve.exports at build time */
  function buildTimeTargets(request: string): string[] {
    for (const preferRequire of [true, false]) {
      try {
        const resolved = resolveExportsImports({ imports }, request, {
          require: preferRequire,
        });
        if (resolved) return ([] as string[]).concat(resolved);
      } catch {
        // unknown key or no matching condition
      }
    }
    return [];
  }

  for (const request of requests) {
    it(`agrees with the build-time resolution of ${request}`, () => {
      const found = resolveImportsTargets(imports, request);
      assert.deepEqual(found ? found.targets : [], buildTimeTargets(request));
    });
  }

  it('prefers an exact key, then the longest pattern key', () => {
    const targets = (request: string) =>
      resolveImportsTargets(imports, request)?.targets;

    assert.deepEqual(targets('#dir/exact'), ['./dir-exact.js']);
    assert.deepEqual(targets('#dir/other'), ['./dir/other.js']);
    assert.deepEqual(targets('#tie/value.js'), ['./tie-long/value.js']);
    assert.deepEqual(targets('#late/value.js'), ['./late-long/value.js']);
    assert.deepEqual(targets('#tie/value.ts'), ['./tie-short/value.ts']);
  });

  it('tells an unknown key from a key without a matching condition', () => {
    assert.equal(resolveImportsTargets(imports, '#unknown'), null);
    assert.deepEqual(resolveImportsTargets(imports, '#browser'), {
      key: '#browser',
      targets: [],
    });
  });
});
