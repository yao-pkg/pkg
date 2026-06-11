import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { supportsBuildSea } from '../../lib/sea';

// `node --build-sea` (in-core SEA blob injection via Node's bundled, current
// LIEF) landed in Node v25.5.0. pkg prefers it over the external postject when
// the generator Node is new enough — postject's old vendored LIEF corrupts the
// dynamic symbol table of PIE binaries, breaking native addons in the SEA. This
// suite pins the version boundary; the full --build-sea path is covered by the
// SEA e2e tests when run on a >= 25.5 host.
describe('supportsBuildSea', () => {
  it('is false below 25.5', () => {
    assert.equal(supportsBuildSea('v24.16.0'), false);
    assert.equal(supportsBuildSea('v25.0.0'), false);
    assert.equal(supportsBuildSea('v25.4.9'), false);
  });

  it('is true at the 25.5.0 boundary and above', () => {
    assert.equal(supportsBuildSea('v25.5.0'), true);
    assert.equal(supportsBuildSea('v25.6.0'), true);
    assert.equal(supportsBuildSea('v26.3.0'), true);
    assert.equal(supportsBuildSea('v30.0.0'), true);
  });

  it('accepts versions with or without a leading "v"', () => {
    assert.equal(supportsBuildSea('25.5.0'), true);
    assert.equal(supportsBuildSea('24.16.0'), false);
  });

  it('is false for unparseable input', () => {
    assert.equal(supportsBuildSea(''), false);
    assert.equal(supportsBuildSea('not-a-version'), false);
  });
});
