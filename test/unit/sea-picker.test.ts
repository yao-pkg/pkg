import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickMatchingHostTargetIndex } from '../../lib/sea';

// Isolated coverage of step 1 of the SEA blob-generator selection
// (discussion #236): the generator node binary must be version-matched
// to every target, otherwise the final SEA crashes at startup in
// node::sea::FindSingleExecutableResource. The full pipeline is covered
// by test-00-sea; this suite exercises the picker alone.
describe('pickMatchingHostTargetIndex', () => {
  it('returns the index of the first exact platform+arch match', () => {
    assert.equal(
      pickMatchingHostTargetIndex({ platform: 'linux', arch: 'x64' }, [
        { platform: 'linux', arch: 'x64' },
        { platform: 'macos', arch: 'arm64' },
      ]),
      0,
    );
  });

  it('scans past non-matching entries to find the host', () => {
    assert.equal(
      pickMatchingHostTargetIndex({ platform: 'linux', arch: 'x64' }, [
        { platform: 'macos', arch: 'arm64' },
        { platform: 'linux', arch: 'x64' },
        { platform: 'win', arch: 'x64' },
      ]),
      1,
    );
  });

  it('returns -1 on pure cross-platform builds (no host platform in list)', () => {
    // Forces the host-platform download fallback in pickBlobGeneratorBinary.
    assert.equal(
      pickMatchingHostTargetIndex({ platform: 'linux', arch: 'x64' }, [
        { platform: 'macos', arch: 'arm64' },
        { platform: 'win', arch: 'x64' },
      ]),
      -1,
    );
  });

  it('treats same-platform different-arch as a non-match', () => {
    // Historically pkg used nodePaths[0] here (a cross-arch binary) and
    // failed to spawn.
    assert.equal(
      pickMatchingHostTargetIndex({ platform: 'macos', arch: 'arm64' }, [
        { platform: 'macos', arch: 'x64' },
      ]),
      -1,
    );
  });

  it('returns -1 for alpine hosts (hostPlatform never matches a target platform)', () => {
    // @yao-pkg/pkg-fetch reports hostPlatform='alpine', which never equals
    // any user-visible target ('linux', 'linuxstatic', 'macos', 'win').
    // Alpine builds therefore go through the fallback, where the
    // version-safety check in pickBlobGeneratorBinary accepts process.execPath
    // (same version) or throws.
    assert.equal(
      pickMatchingHostTargetIndex({ platform: 'alpine', arch: 'x64' }, [
        { platform: 'linux', arch: 'x64' },
        { platform: 'linuxstatic', arch: 'x64' },
      ]),
      -1,
    );
  });

  it('returns -1 on an empty target list without throwing', () => {
    // pkg enforces at least one target elsewhere, but the helper must stay
    // defensive.
    assert.equal(
      pickMatchingHostTargetIndex({ platform: 'linux', arch: 'x64' }, []),
      -1,
    );
  });
});
