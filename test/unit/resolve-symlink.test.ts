import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const shared = createRequire(__filename)('../../prelude/bootstrap-shared.js');
const resolveSymlink = shared.resolveSymlink as (
  _p: string,
  _sep: string,
  _symlinks: Record<string, string>,
  _cache: Map<string, string>,
) => string;

// resolveSymlink() backs both the classic bootstrap (prelude/bootstrap.js)
// and the SEA VFS provider (prelude/sea-vfs-setup.js) — see #295/#296. These
// are table-driven pure-logic tests against the shared implementation
// directly, requested during PR review as a complement to the e2e
// test-99-#295 (which only covers one level of symlink nesting end to end).
describe('resolveSymlink', () => {
  it('returns non-symlinked paths unchanged', () => {
    const symlinks = { '/snapshot/linked': '/snapshot/real' };
    const cache = new Map();
    assert.equal(
      resolveSymlink('/snapshot/other/file.js', '/', symlinks, cache),
      '/snapshot/other/file.js',
    );
  });

  it('resolves an exact match (the path itself is the symlink)', () => {
    const symlinks = { '/snapshot/linked': '/snapshot/real' };
    const cache = new Map();
    assert.equal(
      resolveSymlink('/snapshot/linked', '/', symlinks, cache),
      '/snapshot/real',
    );
  });

  it('resolves a nested path under a symlinked directory', () => {
    const symlinks = { '/snapshot/linked': '/snapshot/real' };
    const cache = new Map();
    assert.equal(
      resolveSymlink('/snapshot/linked/lib/deep/file.js', '/', symlinks, cache),
      '/snapshot/real/lib/deep/file.js',
    );
  });

  it('resolves the shallowest matching symlink first (POSIX order)', () => {
    // Two independent symlinks where one path is a literal prefix of the
    // other. Real manifests built from an actual filesystem walk can't
    // produce this (a symlinked directory's contents aren't walked, so
    // nothing "under" it becomes a separate entry) — this is a synthetic
    // case to lock in walk direction, matching real POSIX symlink
    // resolution (shallowest component wins, not longest-prefix-match).
    const symlinks = {
      '/a': '/shallow-target',
      '/a/b': '/deep-target',
    };
    const cache = new Map();
    assert.equal(
      resolveSymlink('/a/b/c', '/', symlinks, cache),
      '/shallow-target/b/c',
    );
  });

  it('chains through multiple independent symlinks', () => {
    const symlinks = {
      '/a': '/b',
      '/b/c': '/d',
    };
    const cache = new Map();
    // /a/c/file.js -> (hop 1: /a -> /b) /b/c/file.js
    //              -> (hop 2: /b/c -> /d) /d/file.js
    assert.equal(
      resolveSymlink('/a/c/file.js', '/', symlinks, cache),
      '/d/file.js',
    );
  });

  it('avoids a double separator when the target ends with one', () => {
    // Regression case from review: a symlink whose target is the bare root.
    const symlinks = { '/node_modules/@t/root': '/' };
    const cache = new Map();
    assert.equal(
      resolveSymlink(
        '/node_modules/@t/root/package.json',
        '/',
        symlinks,
        cache,
      ),
      '/package.json',
    );
  });

  it('avoids a double separator for any target ending with a separator, not just root', () => {
    const symlinks = { '/snapshot/linked': '/snapshot/real/' };
    const cache = new Map();
    assert.equal(
      resolveSymlink('/snapshot/linked/file.js', '/', symlinks, cache),
      '/snapshot/real/file.js',
    );
  });

  it('throws ELOOP on a cyclic manifest instead of hanging', () => {
    const symlinks = { '/a': '/a/b' };
    const cache = new Map();
    assert.throws(
      () => resolveSymlink('/a/x', '/', symlinks, cache),
      (err: NodeJS.ErrnoException) => {
        assert.equal(err.code, 'ELOOP');
        return true;
      },
    );
  });

  it('is separator-agnostic (works with a non-"/" separator)', () => {
    const symlinks = { '\\snapshot\\linked': '\\snapshot\\real' };
    const cache = new Map();
    assert.equal(
      resolveSymlink('\\snapshot\\linked\\file.js', '\\', symlinks, cache),
      '\\snapshot\\real\\file.js',
    );
  });

  describe('hits-only cache', () => {
    it('never caches a path that did not traverse a symlink', () => {
      const symlinks = { '/snapshot/linked': '/snapshot/real' };
      const cache = new Map();
      resolveSymlink('/snapshot/unrelated/file.js', '/', symlinks, cache);
      assert.equal(cache.size, 0);
    });

    it('caches a path that resolved through a symlink', () => {
      const symlinks = { '/snapshot/linked': '/snapshot/real' };
      const cache = new Map();
      const result = resolveSymlink(
        '/snapshot/linked/file.js',
        '/',
        symlinks,
        cache,
      );
      assert.equal(cache.size, 1);
      assert.equal(cache.get('/snapshot/linked/file.js'), result);
    });

    it('serves repeat lookups from the cache rather than re-resolving', () => {
      const symlinks: Record<string, string> = {
        '/snapshot/linked': '/snapshot/real',
      };
      const cache = new Map();
      const first = resolveSymlink(
        '/snapshot/linked/file.js',
        '/',
        symlinks,
        cache,
      );
      // Mutate the manifest after the first call: if the second call
      // consults the cache instead of re-walking, it must still return the
      // now-stale first result.
      symlinks['/snapshot/linked'] = '/snapshot/changed';
      const second = resolveSymlink(
        '/snapshot/linked/file.js',
        '/',
        symlinks,
        cache,
      );
      assert.equal(second, first);
    });
  });
});
