import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const shared = createRequire(__filename)('../../prelude/bootstrap-shared.js');
const makeSymlinkResolver = shared.makeSymlinkResolver as (
  _symlinks: Record<string, string>,
  _sep: string,
) => ((_p: string, _display?: string) => string) & {
  parent: (_p: string, _display?: string) => string;
};

// makeSymlinkResolver() backs both the classic bootstrap and the SEA provider.
// test-99-#295 covers one level of nesting end to end; these cover the rest.
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

  it('does not match a key that is only a string prefix of the path', () => {
    // A naive startsWith() would pass every other case here.
    const resolve = makeSymlinkResolver(
      { '/snapshot/foo': '/snapshot/real' },
      '/',
    );
    assert.equal(
      resolve('/snapshot/foobar/x.js'),
      '/snapshot/foobar/x.js',
      'sibling with a longer name must be left alone',
    );
    assert.equal(resolve('/snapshot/foo/x.js'), '/snapshot/real/x.js');
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

  it('resolves the deepest matching symlink (longest prefix wins)', () => {
    // Targets are realpaths, so the deeper key is already the full answer.
    const resolve = makeSymlinkResolver(
      {
        '/a': '/shallow-target',
        '/a/b': '/deep-target',
      },
      '/',
    );
    assert.equal(resolve('/a/b/c'), '/deep-target/c');
  });

  it('follows a directory symlink nested inside another one', () => {
    // An exact key beats its symlinked parent.
    const resolve = makeSymlinkResolver(
      {
        '/app/lib': '/app/reallib',
        '/app/lib/sub': '/app/reallib/realsub',
      },
      '/',
    );
    assert.equal(
      resolve('/app/lib/sub/file.js'),
      '/app/reallib/realsub/file.js',
    );
    // A sibling with no entry of its own still follows the parent link.
    assert.equal(resolve('/app/lib/other.js'), '/app/reallib/other.js');
  });

  it('follows a nested link keyed under the real directory', () => {
    // The shape the walker emits: the inner link is keyed under reallib/.
    const resolve = makeSymlinkResolver(
      {
        '/app/lib': '/app/reallib',
        '/app/reallib/sub': '/app/reallib/realsub',
      },
      '/',
    );
    assert.equal(
      resolve('/app/lib/sub/file.js'),
      '/app/reallib/realsub/file.js',
    );
    assert.equal(
      resolve('/app/reallib/sub/file.js'),
      '/app/reallib/realsub/file.js',
    );
  });

  it('prefers an exact entry over its symlinked parent', () => {
    // Both keys exist; the exact (more specific) one must win.
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

  it('reports the caller path, not the internal key, on ELOOP', () => {
    const resolve = makeSymlinkResolver({ '/a': '/a/b' }, '/');
    assert.throws(() => resolve('/a/x', 'C:\\snapshot\\a\\x'), {
      code: 'ELOOP',
      path: 'C:\\snapshot\\a\\x',
    });
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

  describe('resolveKey.parent — the readlink/lstat step', () => {
    // POSIX resolves a path's parents before reading its last component, so an
    // entry recorded under an already-followed parent stays reachable. Both
    // bootstraps drive this, which is why it lives on the resolver.
    it('resolves the parents and keeps the last component', () => {
      const resolve = makeSymlinkResolver(
        { '/snapshot/lib': '/snapshot/reallib' },
        '/',
      );
      assert.equal(
        resolve.parent('/snapshot/lib/inner.js'),
        '/snapshot/reallib/inner.js',
      );
    });

    it('does not follow the last component itself', () => {
      // The whole point: resolve() would answer /snapshot/reallib here.
      const resolve = makeSymlinkResolver(
        { '/snapshot/lib': '/snapshot/reallib' },
        '/',
      );
      assert.equal(resolve.parent('/snapshot/lib'), '/snapshot/lib');
    });

    it('is present on the empty-manifest fast path too', () => {
      // The identity resolver is what a symlink-free binary gets, which is
      // most of them — readlink and lstat call .parent unconditionally.
      const resolve = makeSymlinkResolver({}, '/');
      assert.equal(typeof resolve.parent, 'function');
      assert.equal(
        resolve.parent('/snapshot/app/lib/inner.js'),
        '/snapshot/app/lib/inner.js',
      );
    });

    it('leaves a key with no parent alone', () => {
      const resolve = makeSymlinkResolver({ '/a': '/b' }, '/');
      assert.equal(resolve.parent('/a'), '/a');
      assert.equal(resolve.parent('a'), 'a');
    });

    it('walks win32 keys on their own separator', () => {
      const resolve = makeSymlinkResolver(
        { 'C:\\snapshot\\lib': 'C:\\snapshot\\reallib' },
        '\\',
      );
      assert.equal(
        resolve.parent('C:\\snapshot\\lib\\inner.js'),
        'C:\\snapshot\\reallib\\inner.js',
      );
    });
  });

  describe('the MAX_SYMLINK_DEPTH bound', () => {
    // Chain of `n` links ending at '/end': /l0 -> /l1 -> ... -> /ln -> /end.
    const chain = (n: number) => {
      const m: Record<string, string> = {};
      for (let i = 0; i < n; i += 1) m[`/l${i}`] = `/l${i + 1}`;
      m[`/l${n}`] = '/end';
      return m;
    };

    it('allows 40 links and rejects 41, like SYMLOOP_MAX', () => {
      // chain(n) is n + 1 links.
      assert.equal(makeSymlinkResolver(chain(39), '/')('/l0'), '/end');
      assert.throws(() => makeSymlinkResolver(chain(40), '/')('/l0'), {
        code: 'ELOOP',
      });
    });
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

  it('walks win32 keys that carry a drive letter', () => {
    const resolve = makeSymlinkResolver(
      {
        'C:\\snapshot\\lib': 'C:\\snapshot\\reallib',
        'C:\\snapshot\\lib\\sub': 'C:\\snapshot\\reallib\\realsub',
      },
      '\\',
    );
    assert.equal(
      resolve('C:\\snapshot\\lib\\sub\\file.js'),
      'C:\\snapshot\\reallib\\realsub\\file.js',
    );
    assert.equal(
      resolve('C:\\snapshot\\lib\\other.js'),
      'C:\\snapshot\\reallib\\other.js',
    );
  });

  describe('empty manifest', () => {
    it('returns every path unchanged', () => {
      const resolve = makeSymlinkResolver({}, '/');
      assert.equal(resolve('/snapshot/app/index.js'), '/snapshot/app/index.js');
    });
  });
});
