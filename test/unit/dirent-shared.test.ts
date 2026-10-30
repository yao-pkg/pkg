import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const shared = createRequire(__filename)('../../prelude/bootstrap-shared.js');

type Stat = {
  mode: number;
  size: number;
  blocks: number;
  nlink: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

const {
  Dirent,
  asSymlinkStat,
  linkTarget,
  applyReadlinkEncoding,
  UV_DIRENT_FILE,
  UV_DIRENT_DIR,
  UV_DIRENT_LINK,
} = shared as {
  Dirent: new (
    _name: string,
    _type: number,
    _parentPath: string,
  ) => {
    name: string;
    parentPath: string;
    path?: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSocket(): boolean;
    isFIFO(): boolean;
  };
  asSymlinkStat: (_s: Stat, _target: string) => Stat;
  linkTarget: (
    _symlinks: Record<string, string>,
    _key: string,
    _resolvedKey: string,
  ) => string | undefined;
  applyReadlinkEncoding: (
    _target: string,
    _options: unknown,
  ) => string | Buffer;
  UV_DIRENT_FILE: number;
  UV_DIRENT_DIR: number;
  UV_DIRENT_LINK: number;
};

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

function throughLinkStat(mode: number): Stat {
  return {
    mode,
    size: 4096,
    blocks: 8,
    nlink: 3,
    isFile: () => (mode & S_IFMT) === S_IFREG,
    isDirectory: () => (mode & S_IFMT) === S_IFDIR,
    isSymbolicLink: () => false,
  };
}

// These back readdir, lstat and readlink in both bootstraps, so a change here
// moves classic and SEA together.
describe('shared Dirent', () => {
  it('reports exactly one type per libuv constant', () => {
    const cases: [number, 'isFile' | 'isDirectory' | 'isSymbolicLink'][] = [
      [UV_DIRENT_FILE, 'isFile'],
      [UV_DIRENT_DIR, 'isDirectory'],
      [UV_DIRENT_LINK, 'isSymbolicLink'],
    ];
    for (const [type, predicate] of cases) {
      const d = new Dirent('entry', type, '/snapshot/app');
      for (const p of ['isFile', 'isDirectory', 'isSymbolicLink'] as const) {
        assert.equal(d[p](), p === predicate, `${p} for type ${type}`);
      }
    }
  });

  it('answers false for device types', () => {
    const d = new Dirent('node_modules', UV_DIRENT_LINK, '/snapshot/app');
    assert.equal(d.isBlockDevice(), false);
    assert.equal(d.isCharacterDevice(), false);
    assert.equal(d.isSocket(), false);
    assert.equal(d.isFIFO(), false);
  });

  it('carries parentPath, and `path` only where Node still has it', () => {
    const d = new Dirent('lib', UV_DIRENT_LINK, '/snapshot/app');
    assert.equal(d.parentPath, '/snapshot/app');
    const major = Number(process.versions.node.split('.')[0]);
    assert.equal('path' in d, major < 24);
  });
});

describe('linkTarget', () => {
  const symlinks = {
    '/app/lib': '/app/reallib',
    '/app/reallib/other.js': '/app/reallib/log.js',
  };

  it('prefers the spelling the caller used', () => {
    assert.equal(linkTarget(symlinks, '/app/lib', '/app/lib'), '/app/reallib');
  });

  it('finds a link recorded under its real parent', () => {
    assert.equal(
      linkTarget(symlinks, '/app/lib/other.js', '/app/reallib/other.js'),
      '/app/reallib/log.js',
    );
  });

  it('answers undefined for a non-link and for inherited keys', () => {
    assert.equal(linkTarget(symlinks, '/app/x.js', '/app/x.js'), undefined);
    assert.equal(linkTarget(symlinks, 'constructor', 'toString'), undefined);
  });
});

describe('asSymlinkStat', () => {
  it('flips the predicates a stat taken through the link got wrong', () => {
    const s = asSymlinkStat(throughLinkStat(S_IFDIR | 0o755), '/snapshot/x');
    assert.equal(s.isSymbolicLink(), true);
    assert.equal(s.isDirectory(), false);
    assert.equal(s.isFile(), false);
  });

  it('rewrites the type bits without disturbing the permissions', () => {
    for (const base of [S_IFREG | 0o644, S_IFDIR | 0o755]) {
      const s = asSymlinkStat(throughLinkStat(base), '/snapshot/x');
      assert.equal(s.mode & S_IFMT, S_IFLNK);
      assert.equal(s.mode & 0o777, base & 0o777);
    }
  });

  it('sizes the link by its target string in bytes, with no blocks', () => {
    const s = asSymlinkStat(throughLinkStat(S_IFREG | 0o644), '/snapshot/é');
    assert.equal(s.size, Buffer.byteLength('/snapshot/é'));
    assert.equal(s.blocks, 0);
    assert.equal(s.nlink, 1);
  });
});

describe('readlink encoding', () => {
  it('answers a Buffer for buffer, re-encodes others, passes utf8 through', () => {
    const b = applyReadlinkEncoding('/a', { encoding: 'buffer' });
    assert.ok(Buffer.isBuffer(b));
    assert.equal(b.toString(), '/a');
    assert.equal(
      applyReadlinkEncoding('/a', 'hex'),
      Buffer.from('/a').toString('hex'),
    );
    assert.equal(applyReadlinkEncoding('/a', 'utf8'), '/a');
    assert.equal(applyReadlinkEncoding('/a', undefined), '/a');
  });
});
