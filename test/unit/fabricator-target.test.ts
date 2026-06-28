import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fabricatorForTarget } from '../../lib/index';
import type { NodeTarget } from '../../lib/types';

// fabricatorForTarget picks which Node binary compiles app JS to V8 bytecode.
// The cross-OS Windows-under-Wine branch (opt-in via --cross-bytecode) must
// engage ONLY for a same-arch win target on a linux/alpine host, and must not
// disturb the existing host / cross-arch (linuxstatic/QEMU) selection. `host`
// is injected so the branch table can be pinned without depending on the
// machine running the suite.
const mk = (platform: string, arch: string, nodeRange = 'node22'): NodeTarget =>
  ({ nodeRange, platform, arch }) as unknown as NodeTarget;

describe('fabricatorForTarget', () => {
  it('win target, same arch, linux host, flag on → win (Wine)', () => {
    const f = fabricatorForTarget(mk('win', 'x64'), true, {
      platform: 'linux',
      arch: 'x64',
    });
    assert.equal(f.platform, 'win');
    assert.equal(f.arch, 'x64');
    assert.equal(f.nodeRange, 'node22');
  });

  it('win target, same arch, alpine host, flag on → win (Wine)', () => {
    const f = fabricatorForTarget(mk('win', 'x64'), true, {
      platform: 'alpine',
      arch: 'x64',
    });
    assert.equal(f.platform, 'win');
  });

  it('win target, same arch, linux host, flag OFF → host platform (no regression)', () => {
    const f = fabricatorForTarget(mk('win', 'x64'), false, {
      platform: 'linux',
      arch: 'x64',
    });
    assert.equal(f.platform, 'linux');
  });

  it('win target, DIFFERENT arch, linux host, flag on → linuxstatic (cross-arch wins, Wine not used)', () => {
    // win-arm64 from an x64 host needs CPU emulation and is out of scope; the
    // cross-arch branch must take precedence over the Wine branch.
    const f = fabricatorForTarget(mk('win', 'arm64'), true, {
      platform: 'linux',
      arch: 'x64',
    });
    assert.equal(f.platform, 'linuxstatic');
  });

  it('non-win target on linux host, flag on → host platform (unaffected)', () => {
    const f = fabricatorForTarget(mk('linux', 'x64'), true, {
      platform: 'linux',
      arch: 'x64',
    });
    assert.equal(f.platform, 'linux');
  });

  it('win target on a win host → win (native build, no Wine branch)', () => {
    const f = fabricatorForTarget(mk('win', 'x64'), true, {
      platform: 'win',
      arch: 'x64',
    });
    assert.equal(f.platform, 'win');
  });

  it('win target on a macos host, flag on → host platform (Wine branch is linux/alpine only)', () => {
    const f = fabricatorForTarget(mk('win', 'x64'), true, {
      platform: 'macos',
      arch: 'x64',
    });
    assert.equal(f.platform, 'macos');
  });

  it('cross-arch on linux host (non-win target) still selects linuxstatic', () => {
    const f = fabricatorForTarget(mk('linux', 'arm64'), false, {
      platform: 'linux',
      arch: 'x64',
    });
    assert.equal(f.platform, 'linuxstatic');
  });

  it('preserves nodeRange and arch through the win branch', () => {
    const f = fabricatorForTarget(mk('win', 'x64', 'node24'), true, {
      platform: 'linux',
      arch: 'x64',
    });
    assert.equal(f.nodeRange, 'node24');
    assert.equal(f.arch, 'x64');
  });
});
