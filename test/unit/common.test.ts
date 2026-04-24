import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
