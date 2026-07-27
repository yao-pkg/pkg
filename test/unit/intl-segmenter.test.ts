import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const shared = createRequire(__filename)('../../prelude/bootstrap-shared.js');

// patchIntlSegmenter works around nodejs/node#51752, where segment()
// segfaults on small-icu builds with no break-iterator data. The unit
// suite runs on an official full-icu Node.js, so the case to lock in here
// is the one that would silently break healthy runtimes: on a base where
// Intl.Segmenter works, the patch must leave it alone. The crashing base
// is covered end-to-end by test-50-intl-segmenter.
describe('patchIntlSegmenter', () => {
  it('leaves Intl.Segmenter alone when break-iterator data is present', () => {
    const hasBreakData =
      new Intl.DateTimeFormat('de').resolvedOptions().locale === 'de' &&
      new Intl.DateTimeFormat('ja').resolvedOptions().locale === 'ja';

    // Nothing to assert on a host that is itself affected.
    if (!hasBreakData) return;

    const before = Intl.Segmenter.prototype.segment;
    shared.patchIntlSegmenter();

    assert.equal(Intl.Segmenter.prototype.segment, before);
    assert.equal([...new Intl.Segmenter().segment('⠋ hi ✔')].length, 6);
  });
});
