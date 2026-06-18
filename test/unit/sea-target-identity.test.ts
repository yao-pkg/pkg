import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { system } from '@yao-pkg/pkg-fetch';

import { expectedProcessPlatform, expectedProcessArch } from '../../lib/sea';

// The SEA custom-base guard validates a supplied node binary by *running* it
// and comparing its reported process.platform / process.arch to the target.
// pkg's target identifiers (alpine, linuxstatic, macos, win, armv7l, x86, …)
// are NOT the values Node reports, so they must be translated first. These maps
// are easy to get wrong in a way that only bites a non-host target — which the
// e2e can't reach (it feeds the host's own node, hitting probeNode's
// process.execPath short-circuit). So pin the translation here, over the full
// known* sets, so a wrong/missing mapping fails in CI rather than shipping.

describe('expectedProcessPlatform', () => {
  it('translates every known pkg platform to a Node process.platform', () => {
    // Total over knownPlatforms: a newly-added target with no mapping throws
    // here instead of silently falling through to a wrong identity default.
    for (const platform of system.knownPlatforms) {
      const reported = expectedProcessPlatform(platform);
      assert.equal(
        typeof reported,
        'string',
        `${platform} should map to a process.platform string`,
      );
      assert.ok(
        reported.length > 0,
        `${platform} should map to a non-empty value`,
      );
    }
  });

  it('maps the pkg-specific aliases to their Node names', () => {
    assert.equal(expectedProcessPlatform('macos'), 'darwin');
    assert.equal(expectedProcessPlatform('win'), 'win32');
    // alpine / linuxstatic are pkg-fetch flavors of Linux; Node reports 'linux'
    // for all of them (the musl/static distinction isn't in process.platform).
    assert.equal(expectedProcessPlatform('linux'), 'linux');
    assert.equal(expectedProcessPlatform('alpine'), 'linux');
    assert.equal(expectedProcessPlatform('linuxstatic'), 'linux');
    assert.equal(expectedProcessPlatform('freebsd'), 'freebsd');
  });

  it('throws (rather than guessing) for an unknown platform', () => {
    assert.throws(
      () => expectedProcessPlatform('plan9'),
      /no process\.platform mapping/i,
    );
  });
});

describe('expectedProcessArch', () => {
  it('translates every known pkg arch to a Node process.arch', () => {
    for (const arch of system.knownArchs) {
      const reported = expectedProcessArch(arch);
      assert.equal(
        typeof reported,
        'string',
        `${arch} should map to a process.arch string`,
      );
      assert.ok(reported.length > 0, `${arch} should map to a non-empty value`);
    }
  });

  it('maps the pkg-specific aliases to their Node names', () => {
    // pkg uses armv7/armv7l and x86; Node reports 'arm' and 'ia32'.
    assert.equal(expectedProcessArch('armv7'), 'arm');
    assert.equal(expectedProcessArch('armv7l'), 'arm');
    assert.equal(expectedProcessArch('x86'), 'ia32');
    // The rest pass through unchanged.
    assert.equal(expectedProcessArch('x64'), 'x64');
    assert.equal(expectedProcessArch('arm64'), 'arm64');
    assert.equal(expectedProcessArch('ppc64'), 'ppc64');
    assert.equal(expectedProcessArch('s390x'), 's390x');
    assert.equal(expectedProcessArch('riscv64'), 'riscv64');
    assert.equal(expectedProcessArch('loong64'), 'loong64');
  });

  it('throws (rather than guessing) for an unknown arch', () => {
    assert.throws(
      () => expectedProcessArch('sparc64'),
      /no process\.arch mapping/i,
    );
  });
});
