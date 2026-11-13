import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getNodeDist } from '../../lib/sea';

const OFFICIAL = 'https://nodejs.org/dist';
const UNOFFICIAL = 'https://unofficial-builds.nodejs.org/download/release';

describe('getNodeDist', () => {
  it('maps alpine to the musl build on unofficial-builds', () => {
    assert.deepEqual(getNodeDist({ platform: 'alpine', arch: 'x64' }), {
      os: 'linux',
      arch: 'x64-musl',
      baseUrl: UNOFFICIAL,
    });
    assert.deepEqual(getNodeDist({ platform: 'alpine', arch: 'arm64' }), {
      os: 'linux',
      arch: 'arm64-musl',
      baseUrl: UNOFFICIAL,
    });
  });

  it('keeps glibc linux, macos and win on nodejs.org', () => {
    assert.deepEqual(getNodeDist({ platform: 'linux', arch: 'x64' }), {
      os: 'linux',
      arch: 'x64',
      baseUrl: OFFICIAL,
    });
    assert.deepEqual(getNodeDist({ platform: 'macos', arch: 'arm64' }), {
      os: 'darwin',
      arch: 'arm64',
      baseUrl: OFFICIAL,
    });
    assert.deepEqual(getNodeDist({ platform: 'win', arch: 'x64' }), {
      os: 'win',
      arch: 'x64',
      baseUrl: OFFICIAL,
    });
  });

  it('routes riscv64 and loong64 to unofficial-builds', () => {
    for (const arch of ['riscv64', 'loong64']) {
      assert.deepEqual(getNodeDist({ platform: 'linux', arch }), {
        os: 'linux',
        arch,
        baseUrl: UNOFFICIAL,
      });
    }
  });

  it('rejects platforms and archs with no nodejs.org build', () => {
    assert.throws(
      () => getNodeDist({ platform: 'linuxstatic', arch: 'x64' }),
      /Unsupported OS: linuxstatic/,
    );
    assert.throws(
      () => getNodeDist({ platform: 'linux', arch: 'x64-musl' }),
      /Unsupported architecture: x64-musl/,
    );
  });
});
