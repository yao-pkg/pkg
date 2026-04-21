#!/usr/bin/env node

'use strict';

// Unit test for the SEA blob-generator selection logic introduced to
// fix discussion #236: the generator node binary must be version-matched
// to every target binary pkg will inject into, otherwise the final SEA
// crashes at startup in node::sea::FindSingleExecutableResource.
//
// The full pipeline is covered by test-00-sea; this test isolates
// step 1 (host-matching) so regressions surface without a full build.

const assert = require('assert');
const { pickMatchingHostTargetIndex } = require('../../lib-es5/sea');

// Exact platform+arch match → return that target's index so its already
// downloaded binary (version-identical to the one being injected into)
// is reused as the generator.
assert.strictEqual(
  pickMatchingHostTargetIndex({ platform: 'linux', arch: 'x64' }, [
    { platform: 'linux', arch: 'x64' },
    { platform: 'macos', arch: 'arm64' },
  ]),
  0,
);

// Host matches the second target, not the first.
assert.strictEqual(
  pickMatchingHostTargetIndex({ platform: 'linux', arch: 'x64' }, [
    { platform: 'macos', arch: 'arm64' },
    { platform: 'linux', arch: 'x64' },
    { platform: 'win', arch: 'x64' },
  ]),
  1,
);

// Pure cross-platform build (Linux host, macOS-only targets) — no match,
// forcing the host-platform download fallback in pickBlobGeneratorBinary.
assert.strictEqual(
  pickMatchingHostTargetIndex({ platform: 'linux', arch: 'x64' }, [
    { platform: 'macos', arch: 'arm64' },
    { platform: 'win', arch: 'x64' },
  ]),
  -1,
);

// Same platform, different arch — NOT a match. Historically pkg would
// have used nodePaths[0] here (a cross-arch binary) and failed to spawn.
assert.strictEqual(
  pickMatchingHostTargetIndex({ platform: 'macos', arch: 'arm64' }, [
    { platform: 'macos', arch: 'x64' },
  ]),
  -1,
);

// Alpine hosts report hostPlatform='alpine' (from @yao-pkg/pkg-fetch),
// which never equals any user-visible target platform ('linux',
// 'linuxstatic', 'macos', 'win'). This drives alpine builds through the
// fallback path, where pickBlobGeneratorBinary's version-safety check
// either accepts process.execPath (same version) or throws.
assert.strictEqual(
  pickMatchingHostTargetIndex({ platform: 'alpine', arch: 'x64' }, [
    { platform: 'linux', arch: 'x64' },
    { platform: 'linuxstatic', arch: 'x64' },
  ]),
  -1,
);

// Empty targets → -1. Defensive; pkg enforces at least one target
// elsewhere, but the helper must not throw on an empty list.
assert.strictEqual(
  pickMatchingHostTargetIndex({ platform: 'linux', arch: 'x64' }, []),
  -1,
);

console.log('sea-picker: ok');
