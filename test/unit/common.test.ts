import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import * as common from '../../lib/common';

// `common` branches on `process.platform` at module load. Running the Windows
// assertions on POSIX (or vice versa) would exercise the wrong branch and
// always fail — so each suite is skipped on the wrong host, matching the
// behaviour of the original test-48-common.
const onWin = process.platform === 'win32';

function substituteMany(files: string[]): string[] {
  const d = common.retrieveDenominator(files);
  return files.map((f) => common.substituteDenominator(f, d));
}

describe('common (win32)', { skip: !onWin }, () => {
  it('normalizePath normalizes drive letters and trailing slashes', () => {
    assert.equal(common.normalizePath('c:'), 'c:');
    assert.equal(common.normalizePath('c:\\'), 'C:\\');
    assert.equal(common.normalizePath('c:\\\\'), 'C:\\');
    assert.equal(common.normalizePath('c:\\snapshot'), 'C:\\snapshot');
    assert.equal(common.normalizePath('c:\\snapshoter'), 'C:\\snapshoter');
    assert.equal(common.normalizePath('c:\\snapshot\\'), 'C:\\snapshot');
    assert.equal(common.normalizePath('c:\\snapshoter\\'), 'C:\\snapshoter');
    assert.equal(
      common.normalizePath('c:\\snapshot\\\\foo'),
      'C:\\snapshot\\foo',
    );
    assert.equal(
      common.normalizePath('c:\\snapshot\\\\foo\\\\bar\\/\\\\'),
      'C:\\snapshot\\foo\\bar',
    );
  });

  it('insideSnapshot detects the C:\\snapshot prefix exactly', () => {
    assert.equal(common.insideSnapshot('c:'), false);
    assert.equal(common.insideSnapshot('c:\\'), false);
    assert.equal(common.insideSnapshot('c:\\foo'), false);
    assert.equal(common.insideSnapshot('c:\\foo\\snapshot'), false);
    assert.equal(common.insideSnapshot('c:\\snapshot'), true);
    assert.equal(common.insideSnapshot('c:\\snapshoter'), false);
    assert.equal(common.insideSnapshot('c:\\snapshot\\'), true);
    assert.equal(common.insideSnapshot('c:\\snapshoter\\'), false);
    assert.equal(common.insideSnapshot('c:\\snapshot\\\\'), true);
    assert.equal(common.insideSnapshot('c:\\snapshot\\foo'), true);
    assert.equal(common.insideSnapshot('c:\\snapshoter\\foo'), false);
  });

  it('stripSnapshot replaces the snapshot prefix with the glob marker', () => {
    assert.equal(common.stripSnapshot('c:\\'), 'c:\\');
    assert.equal(common.stripSnapshot('c:\\\\'), 'c:\\\\');
    assert.equal(common.stripSnapshot('c:\\snapshot'), 'C:\\**\\');
    assert.equal(common.stripSnapshot('c:\\snapshoter'), 'c:\\snapshoter');
    assert.equal(common.stripSnapshot('c:\\snapshot\\'), 'C:\\**\\');
    assert.equal(common.stripSnapshot('c:\\snapshoter\\'), 'c:\\snapshoter\\');
    assert.equal(common.stripSnapshot('c:\\snapshot\\\\foo'), 'C:\\**\\foo');
    assert.equal(
      common.stripSnapshot('c:\\snapshot\\\\foo\\\\bar\\/\\\\'),
      'C:\\**\\foo\\bar',
    );
  });

  it('snapshotify injects the snapshot prefix', () => {
    assert.equal(common.snapshotify('C:\\', '\\'), 'C:\\snapshot');
    assert.equal(common.snapshotify('C:\\foo', '\\'), 'C:\\snapshot\\foo');
    assert.equal(
      common.snapshotify('C:\\foo\\bar', '\\'),
      'C:\\snapshot\\foo\\bar',
    );
  });

  it('removeUplevels strips leading ../ segments', () => {
    assert.equal(common.removeUplevels('..\\foo'), 'foo');
    assert.equal(common.removeUplevels('..\\..\\foo'), 'foo');
    assert.equal(common.removeUplevels('.\\foo'), '.\\foo');
    assert.equal(common.removeUplevels('.'), '.');
    assert.equal(common.removeUplevels('..'), '.');
    assert.equal(common.removeUplevels('..\\..'), '.');
  });

  it('retrieveDenominator + substituteDenominator trim the common prefix', () => {
    assert.deepEqual(
      substituteMany([
        'C:\\long\\haired\\freaky\\people',
        'C:\\long\\haired\\aliens',
      ]),
      ['C:\\freaky\\people', 'C:\\aliens'],
    );

    assert.deepEqual(
      substituteMany([
        'C:\\long\\haired\\freaky\\people',
        'C:\\long\\hyphen\\sign',
      ]),
      ['C:\\haired\\freaky\\people', 'C:\\hyphen\\sign'],
    );

    assert.deepEqual(
      substituteMany([
        'C:\\long\\haired\\freaky\\people',
        'D:\\long\\hyphen\\sign',
      ]),
      ['C:\\long\\haired\\freaky\\people', 'D:\\long\\hyphen\\sign'],
    );
  });
});

describe('common (posix)', { skip: onWin }, () => {
  it('normalizePath normalizes roots and trailing slashes', () => {
    assert.equal(common.normalizePath('/'), '/');
    assert.equal(common.normalizePath('//'), '/');
    assert.equal(common.normalizePath('/snapshot'), '/snapshot');
    assert.equal(common.normalizePath('/snapshoter'), '/snapshoter');
    assert.equal(common.normalizePath('/snapshot/'), '/snapshot');
    assert.equal(common.normalizePath('/snapshoter/'), '/snapshoter');
    assert.equal(common.normalizePath('/snapshot//foo'), '/snapshot/foo');
    assert.equal(
      common.normalizePath('/snapshot//foo//bar/\\//'),
      '/snapshot/foo/bar',
    );
  });

  it('insideSnapshot detects the /snapshot prefix exactly', () => {
    assert.equal(common.insideSnapshot(''), false);
    assert.equal(common.insideSnapshot('/'), false);
    assert.equal(common.insideSnapshot('/foo'), false);
    assert.equal(common.insideSnapshot('/foo/snapshot'), false);
    assert.equal(common.insideSnapshot('/snapshot'), true);
    assert.equal(common.insideSnapshot('/snapshoter'), false);
    assert.equal(common.insideSnapshot('/snapshot/'), true);
    assert.equal(common.insideSnapshot('/snapshoter/'), false);
    assert.equal(common.insideSnapshot('/snapshot//'), true);
    assert.equal(common.insideSnapshot('/snapshot/foo'), true);
    assert.equal(common.insideSnapshot('/snapshoter/foo'), false);
  });

  it('stripSnapshot replaces the snapshot prefix with the glob marker', () => {
    assert.equal(common.stripSnapshot('/'), '/');
    assert.equal(common.stripSnapshot('//'), '//');
    assert.equal(common.stripSnapshot('/snapshot'), '/**/');
    assert.equal(common.stripSnapshot('/snapshoter'), '/snapshoter');
    assert.equal(common.stripSnapshot('/snapshot/'), '/**/');
    assert.equal(common.stripSnapshot('/snapshoter/'), '/snapshoter/');
    assert.equal(common.stripSnapshot('/snapshot//foo'), '/**/foo');
    assert.equal(
      common.stripSnapshot('/snapshot//foo//bar/\\//'),
      '/**/foo/bar',
    );
  });

  it('snapshotify injects the snapshot prefix', () => {
    assert.equal(common.snapshotify('/', '/'), '/snapshot');
    assert.equal(common.snapshotify('/foo', '/'), '/snapshot/foo');
    assert.equal(common.snapshotify('/foo/bar', '/'), '/snapshot/foo/bar');
  });

  it('removeUplevels strips leading ../ segments', () => {
    assert.equal(common.removeUplevels('../foo'), 'foo');
    assert.equal(common.removeUplevels('../../foo'), 'foo');
    assert.equal(common.removeUplevels('./foo'), './foo');
    assert.equal(common.removeUplevels('.'), '.');
    assert.equal(common.removeUplevels('..'), '.');
    assert.equal(common.removeUplevels('../..'), '.');
  });

  it('retrieveDenominator + substituteDenominator trim the common prefix', () => {
    assert.deepEqual(
      substituteMany(['/long/haired/freaky/people', '/long/haired/aliens']),
      ['/freaky/people', '/aliens'],
    );

    assert.deepEqual(
      substituteMany(['/long/haired/freaky/people', '/long/hyphen/sign']),
      ['/haired/freaky/people', '/hyphen/sign'],
    );
  });
});

describe('common — platform-independent helpers', () => {
  describe('isPackageJson', () => {
    it('matches on basename regardless of directory', () => {
      assert.equal(common.isPackageJson('package.json'), true);
      assert.equal(common.isPackageJson('/a/b/package.json'), true);
      // Exercise the platform's native separator — path.basename on POSIX
      // does not split on '\\', so a backslash-joined string never reduces
      // to 'package.json' on Linux/macOS.
      assert.equal(
        common.isPackageJson(
          `${process.cwd()}${path.sep}deep${path.sep}package.json`,
        ),
        true,
      );
    });

    it('rejects similar names', () => {
      assert.equal(common.isPackageJson('package-json'), false);
      assert.equal(common.isPackageJson('package.jsonn'), false);
      assert.equal(common.isPackageJson('x-package.json'), false);
      assert.equal(common.isPackageJson('/deep/x-package.json'), false);
    });
  });

  describe('isDotJS / isDotJSON / isDotNODE', () => {
    it('isDotJS accepts .js and .cjs', () => {
      assert.equal(common.isDotJS('a.js'), true);
      assert.equal(common.isDotJS('a.cjs'), true);
      assert.equal(common.isDotJS('a.mjs'), false);
      assert.equal(common.isDotJS('a.ts'), false);
      assert.equal(common.isDotJS('a'), false);
    });

    it('isDotJSON only .json', () => {
      assert.equal(common.isDotJSON('a.json'), true);
      assert.equal(common.isDotJSON('a.json5'), false);
      assert.equal(common.isDotJSON('a.JSON'), false); // case-sensitive on purpose
    });

    it('isDotNODE only .node', () => {
      assert.equal(common.isDotNODE('addon.node'), true);
      assert.equal(common.isDotNODE('addon.nod'), false);
      assert.equal(common.isDotNODE('addon'), false);
    });
  });

  describe('unlikelyJavascript', () => {
    it('rejects known non-JS extensions', () => {
      for (const ext of ['.css', '.html', '.json', '.vue']) {
        assert.equal(
          common.unlikelyJavascript(`foo${ext}`),
          true,
          `expected ${ext} to be unlikely JS`,
        );
      }
    });

    it('recognizes compound .d.ts', () => {
      assert.equal(common.unlikelyJavascript('types.d.ts'), true);
      assert.equal(common.unlikelyJavascript('regular.ts'), false);
    });

    it('accepts .js / .cjs / .mjs as possibly-JS', () => {
      assert.equal(common.unlikelyJavascript('a.js'), false);
      assert.equal(common.unlikelyJavascript('a.cjs'), false);
      assert.equal(common.unlikelyJavascript('a.mjs'), false);
    });
  });

  describe('replaceSlashes', () => {
    it('win-style → /: strips drive and flips backslashes', () => {
      assert.equal(
        common.replaceSlashes('C:\\foo\\bar', '/'),
        '\\foo\\bar'.replace(/\\/g, '/'),
      );
    });

    it('posix → \\: prefixes C: and flips forward slashes', () => {
      assert.equal(common.replaceSlashes('/foo/bar', '\\'), 'C:\\foo\\bar');
    });

    it('no-op when slash matches existing style', () => {
      assert.equal(common.replaceSlashes('C:\\foo\\bar', '\\'), 'C:\\foo\\bar');
      assert.equal(common.replaceSlashes('/foo/bar', '/'), '/foo/bar');
    });

    it('relative paths (no drive, no leading slash) pass through', () => {
      assert.equal(common.replaceSlashes('foo/bar', '\\'), 'foo/bar');
      assert.equal(common.replaceSlashes('foo\\bar', '/'), 'foo\\bar');
    });
  });

  describe('isRootPath', () => {
    it('true for a filesystem root', () => {
      const root = path.parse(process.cwd()).root;
      assert.equal(common.isRootPath(root), true);
    });

    it('false for a non-root directory', () => {
      assert.equal(common.isRootPath(process.cwd()), false);
    });
  });
});

// Covers the recent ESM detection additions. Uses a real temp tree because
// the helpers are built around fs lookups; the tests are still unit-fast
// (~10ms) and fully self-contained — no subprocess, no network.
describe('common — isESMPackage / isESMFile', () => {
  let tmp: string;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-common-esm-'));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('isESMPackage: "type":"module" → true', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'mod-'));
    const pj = path.join(dir, 'package.json');
    fs.writeFileSync(pj, JSON.stringify({ type: 'module' }));
    assert.equal(common.isESMPackage(pj), true);
  });

  it('isESMPackage: absent or "commonjs" type → false', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'cjs-'));
    const pj = path.join(dir, 'package.json');
    fs.writeFileSync(pj, JSON.stringify({ type: 'commonjs' }));
    assert.equal(common.isESMPackage(pj), false);

    const dir2 = fs.mkdtempSync(path.join(tmp, 'untyped-'));
    const pj2 = path.join(dir2, 'package.json');
    fs.writeFileSync(pj2, JSON.stringify({ name: 'x' }));
    assert.equal(common.isESMPackage(pj2), false);
  });

  it('isESMPackage: missing / unparseable → false (no throw)', () => {
    const missing = path.join(tmp, 'nope', 'package.json');
    assert.equal(common.isESMPackage(missing), false);

    const dir = fs.mkdtempSync(path.join(tmp, 'bad-'));
    const pj = path.join(dir, 'package.json');
    fs.writeFileSync(pj, '{ not json');
    assert.equal(common.isESMPackage(pj), false);
  });

  it('isESMFile: .mjs is always ESM, .cjs never', () => {
    // These short-circuit before hitting the filesystem — any path works.
    assert.equal(common.isESMFile('/whatever/a.mjs'), true);
    assert.equal(common.isESMFile('/whatever/a.cjs'), false);
  });

  it('isESMFile: .js resolves against the nearest package.json', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'js-esm-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );
    assert.equal(common.isESMFile(path.join(dir, 'entry.js')), true);

    const dir2 = fs.mkdtempSync(path.join(tmp, 'js-cjs-'));
    fs.writeFileSync(
      path.join(dir2, 'package.json'),
      JSON.stringify({ type: 'commonjs' }),
    );
    assert.equal(common.isESMFile(path.join(dir2, 'entry.js')), false);
  });

  it('isESMFile: non-JS extensions → false', () => {
    assert.equal(common.isESMFile('/a.ts'), false);
    assert.equal(common.isESMFile('/a.json'), false);
  });
});

describe('common — toNormalizedRealPath', () => {
  let tmp: string;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-realpath-'));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('non-existent path passes through normalizePath unchanged', () => {
    const missing = path.join(tmp, 'no-such-thing');
    const out = common.toNormalizedRealPath(missing);
    assert.equal(out, common.normalizePath(missing));
  });

  it('existing path resolves through fs.realpathSync', () => {
    const real = fs.mkdtempSync(path.join(tmp, 'real-'));
    // Compare to realpath of the directory itself (macOS /tmp → /private/tmp
    // differs from the literal path, so naïve equality would fail).
    assert.equal(common.toNormalizedRealPath(real), fs.realpathSync(real));
  });

  it(
    'symlink is resolved to its target',
    {
      // fs.symlinkSync on Windows requires admin or Developer Mode; skip there
      // rather than fight environment setup.
      skip: process.platform === 'win32',
    },
    () => {
      const target = fs.mkdtempSync(path.join(tmp, 'target-'));
      const link = path.join(tmp, 'link-' + Date.now());
      fs.symlinkSync(target, link);

      const resolved = common.toNormalizedRealPath(link);
      // The returned path must equal the real target path (macOS /tmp vs
      // /private/tmp → use fs.realpathSync on both sides of the comparison).
      assert.equal(resolved, fs.realpathSync(target));
    },
  );
});
