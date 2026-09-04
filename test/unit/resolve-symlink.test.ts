import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const shared = createRequire(__filename)('../../prelude/bootstrap-shared.js');
const makeSymlinkResolver = shared.makeSymlinkResolver as (
  _symlinks: Record<string, string>,
  _sep: string,
) => (_p: string) => string;

// makeSymlinkResolver() backs both the classic bootstrap (prelude/bootstrap.js)
// and the SEA VFS provider (prelude/sea-vfs-setup.js) — see #295/#296. These
// are table-driven pure-logic tests against the shared implementation
// directly, requested during PR review as a complement to the e2e
// test-99-#295 (which only covers one level of symlink nesting end to end).
describe('makeSymlinkResolver', () => {
  it('returns non-symlinked paths unchanged', () => {
    const resolve = makeSymlinkResolver(
      { '/snapshot/linked': '/snapshot/real' },
      '/',
    );
    assert.equal(resolve('/snapshot/other/file.js'), '/snapshot/other/file.js');
  });

  it('resolves an exact match (the path itself is the symlink)', () => {
    const resolve = makeSymlinkResolver(
      { '/snapshot/linked': '/snapshot/real' },
      '/',
    );
    assert.equal(resolve('/snapshot/linked'), '/snapshot/real');
  });

  it('resolves a nested path under a symlinked directory', () => {
    const resolve = makeSymlinkResolver(
      { '/snapshot/linked': '/snapshot/real' },
      '/',
    );
    assert.equal(
      resolve('/snapshot/linked/lib/deep/file.js'),
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
    const resolve = makeSymlinkResolver(
      {
        '/a': '/shallow-target',
        '/a/b': '/deep-target',
      },
      '/',
    );
    assert.equal(resolve('/a/b/c'), '/shallow-target/b/c');
  });

  it('prefers an exact entry over its symlinked parent', () => {
    // The real manifest shape: the walker descends through a symlinked
    // directory, so a link inside one gets its own key under the unresolved
    // path. Both keys exist, and the exact (more specific) one must win —
    // resolving through the parent instead would land on a path the archive
    // has no entry for. Regression guard for test-99-#295/reallib/inner.js.
    const resolve = makeSymlinkResolver(
      {
        '/app/lib': '/app/reallib',
        '/app/lib/inner.js': '/app/reallib/log.js',
      },
      '/',
    );
    assert.equal(resolve('/app/lib/inner.js'), '/app/reallib/log.js');
    // A path with no exact entry still follows the symlinked parent.
    assert.equal(resolve('/app/lib/sub/deep.js'), '/app/reallib/sub/deep.js');
  });

  it('chains through multiple independent symlinks', () => {
    const resolve = makeSymlinkResolver(
      {
        '/a': '/b',
        '/b/c': '/d',
      },
      '/',
    );
    // /a/c/file.js -> (hop 1: /a -> /b) /b/c/file.js
    //              -> (hop 2: /b/c -> /d) /d/file.js
    assert.equal(resolve('/a/c/file.js'), '/d/file.js');
  });

  it('avoids a double separator when the target ends with one', () => {
    // Regression case from review: a symlink whose target is the bare root.
    const resolve = makeSymlinkResolver({ '/node_modules/@t/root': '/' }, '/');
    assert.equal(
      resolve('/node_modules/@t/root/package.json'),
      '/package.json',
    );
  });

  it('avoids a double separator for any target ending with a separator, not just root', () => {
    const resolve = makeSymlinkResolver(
      { '/snapshot/linked': '/snapshot/real/' },
      '/',
    );
    assert.equal(resolve('/snapshot/linked/file.js'), '/snapshot/real/file.js');
  });

  it('throws ELOOP on a cyclic manifest instead of hanging', () => {
    const resolve = makeSymlinkResolver({ '/a': '/a/b' }, '/');
    assert.throws(
      () => resolve('/a/x'),
      (err: NodeJS.ErrnoException) => {
        assert.equal(err.code, 'ELOOP');
        return true;
      },
    );
  });

  it('throws ELOOP on a cycle spanning two entries', () => {
    const resolve = makeSymlinkResolver({ '/a': '/b/x', '/b': '/a' }, '/');
    assert.throws(
      () => resolve('/a/f.js'),
      (err: NodeJS.ErrnoException) => {
        assert.equal(err.code, 'ELOOP');
        return true;
      },
    );
  });

  it('keeps throwing ELOOP on a repeat lookup', () => {
    // The in-progress sentinel must not be left behind in the memo, or a
    // caught ELOOP would poison unrelated later lookups.
    const resolve = makeSymlinkResolver({ '/a': '/a/b' }, '/');
    assert.throws(() => resolve('/a/x'), { code: 'ELOOP' });
    assert.throws(() => resolve('/a/y'), { code: 'ELOOP' });
  });

  it('is separator-agnostic (works with a non-"/" separator)', () => {
    const resolve = makeSymlinkResolver(
      { '\\snapshot\\linked': '\\snapshot\\real' },
      '\\',
    );
    assert.equal(
      resolve('\\snapshot\\linked\\file.js'),
      '\\snapshot\\real\\file.js',
    );
  });

  describe('empty manifest', () => {
    it('returns every path unchanged', () => {
      const resolve = makeSymlinkResolver({}, '/');
      assert.equal(resolve('/snapshot/app/index.js'), '/snapshot/app/index.js');
    });

    it('tolerates an absent symlinks record', () => {
      const resolve = makeSymlinkResolver(
        undefined as unknown as Record<string, string>,
        '/',
      );
      assert.equal(resolve('/snapshot/app/index.js'), '/snapshot/app/index.js');
    });
  });

  describe('inherited Object properties', () => {
    // The manifest record is JSON-derived and read with a bracket index, so
    // a path component that names an Object.prototype key must not match.
    for (const key of ['__proto__', 'constructor', 'toString', 'valueOf']) {
      it(`does not treat "${key}" as a symlink`, () => {
        const resolve = makeSymlinkResolver({ '/snapshot/x': '/y' }, '/');
        assert.equal(resolve(`/${key}/file.js`), `/${key}/file.js`);
        assert.equal(resolve(`/${key}`), `/${key}`);
      });
    }
  });

  describe('memoisation', () => {
    it('memoises the symlink hop, not the caller path', () => {
      // Resolve one file, then mutate the manifest and resolve a *different*
      // file under the same link. The stale target proves the memo is keyed
      // on the manifest entry — a cache keyed on the full caller path would
      // re-walk here, and would grow without bound on caller-supplied paths.
      const symlinks: Record<string, string> = {
        '/snapshot/linked': '/snapshot/real',
      };
      const resolve = makeSymlinkResolver(symlinks, '/');
      assert.equal(resolve('/snapshot/linked/a.js'), '/snapshot/real/a.js');

      symlinks['/snapshot/linked'] = '/snapshot/changed';
      assert.equal(resolve('/snapshot/linked/b.js'), '/snapshot/real/b.js');
    });

    it('gives each resolver its own memo', () => {
      const symlinks: Record<string, string> = {
        '/snapshot/linked': '/snapshot/real',
      };
      const first = makeSymlinkResolver(symlinks, '/');
      assert.equal(first('/snapshot/linked/a.js'), '/snapshot/real/a.js');

      symlinks['/snapshot/linked'] = '/snapshot/changed';
      const second = makeSymlinkResolver(symlinks, '/');
      assert.equal(second('/snapshot/linked/a.js'), '/snapshot/changed/a.js');
    });
  });
});
