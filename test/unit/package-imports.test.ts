import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { follow } from '../../lib/follow';
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
  // null excludes: no fallback to a later condition or to `import`
  '#cond-null': { node: null, default: './lib/b.js' },
  '#array-null': [null],
  '#array-empty': { node: [], default: './lib/b.js' },
  '#require-null': { require: null, import: './lib/a.js' },
  '#dot': '.',
  '#dotdot': '..',
  // a bare `*` target is checked after the `*` is filled in
  '#star/*': '*',
  '#missing': './lib/missing.js',
  '#directory': './lib/dir',
  '#parent': '../outside.js',
  '#absolute': '/outside.js',
  '#url': 'node:fs',
  '#node-modules': './node_modules/dep/index.js',
  '#legacy/': './lib/',
};

const requests = [
  ...Object.keys(imports).filter(
    (key) => !key.includes('*') && !key.endsWith('/'),
  ),
  '#dir/b',
  '#dir/deep/c',
  '#dir/../a',
  '#fixed/anything',
  '#abbc',
  '#tie/x.js',
  '#tie/x.ts',
  '#two/x/y',
  '#legacy/a.js',
  '#legacy/',
  '#star//outside.js',
  '#star/../outside.js',
  '#star/./lib/a.js',
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
  // makes '#node-modules' fail on the segment rule, not on a missing file
  'node_modules/dep/index.js',
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

  function mustResolve(request: string, dir: string) {
    const result = resolvePackageImport(request, dir);
    assert.ok(result, `no "imports" in scope of ${dir}`);
    return result;
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
    write('no-imports/node_modules/#local/index.js');
    write('broken/package.json', '{ "imports": ');
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const request of requests) {
    it(`resolves ${request} like node`, () => {
      const expected = nodeResolve(request);
      if (path.isAbsolute(expected)) {
        const result = mustResolve(request, app());
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
      'ERR_INVALID_MODULE_SPECIFIER',
      'MODULE_NOT_FOUND',
    ]) {
      assert.ok(outcomes.has(outcome), `no request with outcome ${outcome}`);
    }
  });

  it('falls back to the import condition (pkg bundles ESM as CJS)', () => {
    assert.equal(nodeResolve('#esm-only'), 'ERR_PACKAGE_IMPORT_NOT_DEFINED');
    assert.equal(mustResolve('#esm-only', app()).target, app('lib', 'b.js'));
  });

  it('returns bare and builtin targets unresolved', () => {
    const bare = mustResolve('#bare', app());
    assert.equal(bare.kind, 'bare');
    assert.equal(bare.target, 'some-package');

    const builtin = mustResolve('#builtin', app());
    assert.equal(builtin.kind, 'bare');
    assert.equal(builtin.target, 'fs');
  });

  it('leaves `#name` to the module lookup without "imports" in scope', async () => {
    assert.equal(
      resolvePackageImport('#exact', path.join(root, 'no-imports')),
      null,
    );
    // what plain node does, see the runtime in prelude/bootstrap.js
    const dir = path.join(root, 'no-imports');
    assert.equal(
      await follow('#local', { basedir: dir }),
      path.join(dir, 'node_modules', '#local', 'index.js'),
    );
  });

  it('returns the declaring package.json of the nearest scope', () => {
    const result = mustResolve('#exact', app('lib', 'dir'));
    assert.equal(result.packageJson, app('package.json'));
    assert.equal(result.config.name, 'app');

    const scoped = mustResolve('#exact', app('scope'));
    assert.equal(scoped.target, app('scope', 'own.js'));
    assert.equal(scoped.packageJson, app('scope', 'package.json'));
    assert.throws(() => resolvePackageImport('#bare', app('scope')));
  });

  it('does not look for the scope past node_modules', () => {
    // node_modules/dep has no package.json: the app's "imports" don't apply
    const dep = app('node_modules', 'dep');
    fs.mkdirSync(dep, { recursive: true });
    assert.equal(resolvePackageImport('#exact', dep), null);
  });

  it('names the reason when the specifier cannot be resolved', () => {
    const cases: [string, string, RegExp][] = [
      ['#unknown', 'app', /'#unknown' from .*: not defined in "imports" of/],
      ['#browser', 'app', /not defined in "imports" of .*package\.json/],
      ['#missing', 'app', /missing\.js is not a file/],
      ['#directory', 'app', /dir is not a file/],
      ['#parent', 'app', /Invalid "imports" target "\.\.\/outside\.js" in/],
      ['#hash', 'app', /Invalid "imports" target "#exact" in/],
      ['#legacy/', 'app', /Invalid module specifier "#legacy\/"/],
      ['#exact', 'broken', /JSON.* in .*broken/],
    ];
    for (const [specifier, dir, message] of cases) {
      assert.throws(
        () => resolvePackageImport(specifier, path.join(root, dir)),
        message,
      );
    }
  });

  it('follow() skips the package.json it is told to ignore', async () => {
    const reported: string[] = [];
    await follow('#exact', {
      basedir: app(),
      ignoreFile: app('package.json'),
      catchReadFile: (packageJson) => reported.push(packageJson),
    });
    assert.deepEqual(reported, []);
  });

  it('follow() reports the declaring package.json after resolving', async () => {
    const reported: string[] = [];
    const file = await follow('#exact', {
      basedir: app(),
      catchReadFile: (packageJson) => reported.push(packageJson),
      catchPackageFilter: (config) => reported.push(config.name as string),
    });
    assert.equal(file, app('lib', 'a.js'));
    assert.deepEqual(reported, [app('package.json'), 'app']);
  });

  it('follow() names the "#" import when its bare target is missing', async () => {
    const reported: string[] = [];
    await assert.rejects(
      follow('#bare', {
        basedir: app(),
        catchReadFile: (packageJson) => reported.push(packageJson),
      }),
      /some-package.*\(target of '#bare' in .*package\.json\)/s,
    );
    // not reported, so the walker doesn't blame the failure on its "main"
    assert.deepEqual(reported, []);
  });
});
