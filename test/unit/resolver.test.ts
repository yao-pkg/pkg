import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolvePackageImport } from '../../lib/resolver';

describe('resolvePackageImport', () => {
  let root: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-resolver-imports-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        imports: {
          '#esm': { import: './esm.mjs' },
          '#cjs': { require: './cjs.js', import: './esm.mjs' },
          '#lib/*': './lib/*.js',
          '#dep': 'some-dep',
          '#arr': ['./arr.js', './fallback.js'],
          '#up': '../outside.js',
          '#abs': '/etc/passwd',
          '#dotdot': './x/../../outside.js',
          '#inner-dotdot': './x/../inside.js',
          '#fs': { node: 'fs', default: './fs-browser.js' },
        },
      }),
    );
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('falls back to the import condition when require has no match', () => {
    assert.equal(
      resolvePackageImport('#esm', path.join(root, 'src')),
      path.join(root, 'esm.mjs'),
    );
  });

  it('prefers the require condition', () => {
    assert.equal(resolvePackageImport('#cjs', root), path.join(root, 'cjs.js'));
  });

  it('expands pattern keys', () => {
    assert.equal(
      resolvePackageImport('#lib/a', root),
      path.join(root, 'lib', 'a.js'),
    );
  });

  it('returns bare package targets as-is', () => {
    assert.equal(resolvePackageImport('#dep', root), 'some-dep');
  });

  it('returns null for an unmapped specifier', () => {
    assert.equal(resolvePackageImport('#missing', root), null);
  });

  it('takes the first entry of an array target', () => {
    assert.equal(resolvePackageImport('#arr', root), path.join(root, 'arr.js'));
  });

  it('rejects targets that leave the package', () => {
    assert.equal(resolvePackageImport('#up', root), null);
    assert.equal(resolvePackageImport('#abs', root), null);
    assert.equal(resolvePackageImport('#dotdot', root), null);
    assert.equal(resolvePackageImport('#lib/../../outside', root), null);
    // Node rejects any ".." segment, even one that stays inside.
    assert.equal(resolvePackageImport('#inner-dotdot', root), null);
  });

  it('returns null for a builtin target', () => {
    assert.equal(resolvePackageImport('#fs', root), null);
  });
});

describe('resolvePackageImport without a usable package.json', () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-resolver-noimports-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when package.json has no "imports"', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
    assert.equal(resolvePackageImport('#util', dir), null);
  });

  it('returns null for malformed package.json', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not json');
    assert.equal(resolvePackageImport('#util', dir), null);
  });
});
