import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolvePackageImport } from '../../lib/resolver';

// resolvePackageImport() must pick the file that plain `node` picks. The
// packaged binary uses the same rules (resolveImportsTarget in
// lib/common.ts); test-54-package-json-imports runs it.

const imports = {
  '#exact': './lib/a.js',
  '#dir/exact': './lib/a.js',
  '#dir/*': './lib/dir/*.js',
  '#fixed/*': './lib/a.js',
  // Node ranks patterns by the part before `*`, then by key length
  '#ab*': './lib/one/*.js',
  '#a*bc': './lib/two/*.js',
  '#tie/*': './lib/short/*',
  '#tie/*.js': './lib/long/*.js',
  '#two/*/*': './lib/a.js',
  '#cond': { node: './lib/a.js', default: './lib/b.js' },
  '#require': { require: './lib/a.js', import: './lib/b.js' },
  '#default-first': { default: './lib/b.js', require: './lib/a.js' },
  // a nested branch without a match falls through to the next condition
  '#nested': { node: { browser: './lib/a.js' }, default: './lib/b.js' },
  '#array': [{ browser: './lib/a.js' }, './lib/b.js'],
  '#array-invalid-first': ['../outside.js', './lib/b.js'],
  // the first valid target of an array counts, existing or not
  '#array-missing-first': ['./lib/missing.js', './lib/b.js'],
  '#browser': { browser: './lib/a.js' },
  '#null': null,
  '#missing': './lib/missing.js',
  '#directory': './lib/dir',
  '#parent': '../outside.js',
  '#absolute': '/outside.js',
  '#url': 'node:fs',
  '#node-modules': './node_modules/dep/index.js',
  '#legacy/': './lib/',
};

const requests = [
  ...Object.keys(imports).filter((key) => !/[*/]$|\*/.test(key)),
  '#dir/b',
  '#dir/deep/c',
  '#dir/../a',
  '#fixed/anything',
  '#abbc',
  '#tie/x.js',
  '#tie/x.ts',
  '#two/x/y',
  '#legacy/a.js',
  '#unknown',
  '#',
];

const files = [
  'lib/a.js',
  'lib/b.js',
  'lib/dir/b.js',
  'lib/dir/deep/c.js',
  'lib/one/bc.js',
  'lib/two/b.js',
  'lib/short/x.js',
  'lib/short/x.ts',
  'lib/long/x.js',
  'scope/own.js',
  'outside.js',
];

describe('resolvePackageImport', () => {
  let root: string;
  const app = (...parts: string[]) => path.join(root, 'app', ...parts);

  function write(file: string, content: unknown = '') {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(
      full,
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }

  /** The file plain `node` resolves `request` to, or the error code */
  function nodeResolve(request: string): string {
    try {
      return createRequire(app('index.js')).resolve(request);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code as string;
    }
  }

  before(() => {
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-imports-')),
    );
    write('app/package.json', {
      name: 'app',
      imports: {
        ...imports,
        '#esm-only': { import: './lib/b.js' },
        '#bare': 'some-package',
        '#builtin': 'fs',
        '#hash': '#exact',
      },
    });
    for (const file of files) write(`app/${file}`);
    write('app/scope/package.json', { imports: { '#exact': './own.js' } });
    write('no-imports/package.json', { name: 'no-imports' });
    write('broken/package.json', '{ "imports": ');
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const request of requests) {
    it(`resolves ${request} like node`, () => {
      const expected = nodeResolve(request);
      if (path.isAbsolute(expected)) {
        const result = resolvePackageImport(request, app());
        assert.equal(result.kind, 'file');
        assert.equal(result.target, expected);
      } else {
        assert.throws(() => resolvePackageImport(request, app()));
      }
    });
  }

  it('covers resolved imports and each kind of failure', () => {
    // guards the comparison above against a table that only fails
    const outcomes = new Set(
      requests.map((request) => {
        const result = nodeResolve(request);
        return path.isAbsolute(result) ? 'resolved' : result;
      }),
    );
    for (const outcome of [
      'resolved',
      'ERR_PACKAGE_IMPORT_NOT_DEFINED',
      'ERR_INVALID_PACKAGE_TARGET',
      'MODULE_NOT_FOUND',
    ]) {
      assert.ok(outcomes.has(outcome), `no request with outcome ${outcome}`);
    }
  });

  it('ranks patterns and conditions like node', () => {
    const target = (request: string) =>
      path
        .relative(app(), resolvePackageImport(request, app()).target)
        .replace(/\\/g, '/');

    assert.equal(target('#dir/exact'), 'lib/a.js');
    assert.equal(target('#abbc'), 'lib/one/bc.js');
    assert.equal(target('#tie/x.js'), 'lib/long/x.js');
    assert.equal(target('#tie/x.ts'), 'lib/short/x.ts');
    assert.equal(target('#nested'), 'lib/b.js');
    assert.equal(target('#default-first'), 'lib/b.js');
    assert.equal(target('#array-invalid-first'), 'lib/b.js');
  });

  it('falls back to the import condition (pkg bundles ESM as CJS)', () => {
    assert.equal(nodeResolve('#esm-only'), 'ERR_PACKAGE_IMPORT_NOT_DEFINED');
    assert.equal(
      resolvePackageImport('#esm-only', app()).target,
      app('lib', 'b.js'),
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

  it('returns the declaring package.json of the nearest scope', () => {
    const result = resolvePackageImport('#exact', app('lib', 'dir'));
    assert.equal(result.packageJson, app('package.json'));
    assert.equal(result.config.name, 'app');

    const scoped = resolvePackageImport('#exact', app('scope'));
    assert.equal(scoped.target, app('scope', 'own.js'));
    assert.equal(scoped.packageJson, app('scope', 'package.json'));
    assert.throws(() => resolvePackageImport('#bare', app('scope')));
  });

  it('names the reason when the specifier cannot be resolved', () => {
    const cases: [string, string, RegExp][] = [
      ['#unknown', 'app', /'#unknown' from .*: not defined in "imports" of/],
      ['#browser', 'app', /not defined in "imports" of .*package\.json/],
      ['#missing', 'app', /missing\.js is not a file/],
      ['#directory', 'app', /dir is not a file/],
      ['#parent', 'app', /Invalid "imports" target "\.\.\/outside\.js" in/],
      ['#hash', 'app', /Invalid "imports" target "#exact" in/],
      ['#exact', 'no-imports', /not defined in "imports" of/],
      ['#exact', 'broken', /JSON.* in .*broken/],
    ];
    for (const [specifier, dir, message] of cases) {
      assert.throws(
        () => resolvePackageImport(specifier, path.join(root, dir)),
        message,
      );
    }
  });
});
