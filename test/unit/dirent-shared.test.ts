import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const shared = createRequire(__filename)('../../prelude/bootstrap-shared.js');

const { Dirent, asSymlinkStat, UV_DIRENT_FILE, UV_DIRENT_DIR, UV_DIRENT_LINK } =
  shared as {
    Dirent: new (
      _name: string,
      _type: number,
    ) => {
      name: string;
      isFile(): boolean;
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
      isBlockDevice(): boolean;
      isCharacterDevice(): boolean;
      isSocket(): boolean;
      isFIFO(): boolean;
    };
    asSymlinkStat: <T>(_s: T) => T;
    UV_DIRENT_FILE: number;
    UV_DIRENT_DIR: number;
    UV_DIRENT_LINK: number;
  };

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

// Dirent and asSymlinkStat back readdir({ withFileTypes: true }) and lstat in
// *both* bootstraps (#296), so a change here moves classic and SEA together.
describe('shared Dirent', () => {
  it('reports exactly one type per libuv constant', () => {
    const cases: [number, 'isFile' | 'isDirectory' | 'isSymbolicLink'][] = [
      [UV_DIRENT_FILE, 'isFile'],
      [UV_DIRENT_DIR, 'isDirectory'],
      [UV_DIRENT_LINK, 'isSymbolicLink'],
    ];
    for (const [type, predicate] of cases) {
      const d = new Dirent('entry', type);
      for (const p of ['isFile', 'isDirectory', 'isSymbolicLink'] as const) {
        assert.equal(d[p](), p === predicate, `${p} for type ${type}`);
      }
    }
  });

  it('uses the libuv numbering real readdir reports', () => {
    assert.deepEqual(
      [UV_DIRENT_FILE, UV_DIRENT_DIR, UV_DIRENT_LINK],
      [1, 2, 3],
    );
  });

  it('keeps the name it was built with and answers false for device types', () => {
    const d = new Dirent('node_modules', UV_DIRENT_LINK);
    assert.equal(d.name, 'node_modules');
    assert.equal(d.isBlockDevice(), false);
    assert.equal(d.isCharacterDevice(), false);
    assert.equal(d.isSocket(), false);
    assert.equal(d.isFIFO(), false);
  });
});

describe('asSymlinkStat', () => {
  it('flips the predicates a stat taken through the link got wrong', () => {
    const s = asSymlinkStat({
      mode: S_IFDIR | 0o755,
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    });
    assert.equal(s.isSymbolicLink(), true);
    assert.equal(s.isDirectory(), false);
    assert.equal(s.isFile(), false);
  });

  it('rewrites the mode type bits without disturbing the permissions', () => {
    for (const base of [S_IFREG | 0o644, S_IFDIR | 0o755]) {
      const s = asSymlinkStat({ mode: base }) as { mode: number };
      assert.equal(s.mode & S_IFMT, S_IFLNK, 'type bits must say S_IFLNK');
      assert.equal(s.mode & 0o777, base & 0o777, 'permissions must survive');
    }
  });

  it('leaves a stat with no numeric mode alone', () => {
    const s = asSymlinkStat({}) as { mode?: number };
    assert.equal(s.mode, undefined);
  });
});
