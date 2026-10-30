import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const shared = createRequire(__filename)('../../prelude/bootstrap-shared.js');
const makeSymlinkResolver = shared.makeSymlinkResolver as (
  _symlinks: Record<string, string>,
  _sep: string,
) => (_p: string, _display?: string) => string;

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
    // The walker keys `<dir>/sub` on the path it walked, through `<dir>`.
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

  it('prefers an exact entry over its symlinked parent', () => {
    // Same shape as test-99-#295/lib/inner.js.
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
});
