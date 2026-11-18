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
});
