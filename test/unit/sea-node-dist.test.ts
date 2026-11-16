import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import {
  assertSingleTargetRange,
  getNodeArchive,
  getNodeDist,
  getNodeVersion,
} from '../../lib/sea';
import type { NodeTarget } from '../../lib/types';

const OFFICIAL = 'https://nodejs.org/dist';
const UNOFFICIAL = 'https://unofficial-builds.nodejs.org/download/release';

describe('getNodeDist', () => {
  it('maps alpine to the musl build on unofficial-builds', () => {
    assert.deepEqual(getNodeDist({ platform: 'alpine', arch: 'x64' }), {
      os: 'linux',
      archiveArch: 'x64-musl',
      baseUrl: UNOFFICIAL,
    });
    assert.deepEqual(getNodeDist({ platform: 'alpine', arch: 'arm64' }), {
      os: 'linux',
      archiveArch: 'arm64-musl',
      baseUrl: UNOFFICIAL,
    });
  });

  it('keeps glibc linux, macos and win on nodejs.org', () => {
    assert.deepEqual(getNodeDist({ platform: 'linux', arch: 'x64' }), {
      os: 'linux',
      archiveArch: 'x64',
      baseUrl: OFFICIAL,
    });
    assert.deepEqual(getNodeDist({ platform: 'macos', arch: 'arm64' }), {
      os: 'darwin',
      archiveArch: 'arm64',
      baseUrl: OFFICIAL,
    });
    assert.deepEqual(getNodeDist({ platform: 'win', arch: 'x64' }), {
      os: 'win',
      archiveArch: 'x64',
      baseUrl: OFFICIAL,
    });
  });

  it('routes riscv64 and loong64 to unofficial-builds', () => {
    for (const arch of ['riscv64', 'loong64']) {
      assert.deepEqual(getNodeDist({ platform: 'linux', arch }), {
        os: 'linux',
        archiveArch: arch,
        baseUrl: UNOFFICIAL,
      });
    }
  });

  it('rejects alpine on archs with no musl build', () => {
    for (const arch of ['riscv64', 'loong64']) {
      assert.throws(
        () => getNodeDist({ platform: 'alpine', arch }),
        new RegExp(`Unsupported architecture for alpine: ${arch}`),
      );
    }
  });
});

describe('getNodeArchive', () => {
  it('names the musl archive and its unofficial-builds URLs', () => {
    assert.deepEqual(
      getNodeArchive(
        getNodeDist({ platform: 'alpine', arch: 'x64' }),
        'v24.1.0',
      ),
      {
        fileName: 'node-v24.1.0-linux-x64-musl.tar.gz',
        url: `${UNOFFICIAL}/v24.1.0/node-v24.1.0-linux-x64-musl.tar.gz`,
        checksumUrl: `${UNOFFICIAL}/v24.1.0/SHASUMS256.txt`,
      },
    );
  });

  it('names glibc, riscv64 and win archives', () => {
    assert.equal(
      getNodeArchive(getNodeDist({ platform: 'linux', arch: 'x64' }), 'v24.1.0')
        .url,
      `${OFFICIAL}/v24.1.0/node-v24.1.0-linux-x64.tar.gz`,
    );
    assert.equal(
      getNodeArchive(
        getNodeDist({ platform: 'linux', arch: 'riscv64' }),
        'v24.1.0',
      ).url,
      `${UNOFFICIAL}/v24.1.0/node-v24.1.0-linux-riscv64.tar.gz`,
    );
    assert.equal(
      getNodeArchive(getNodeDist({ platform: 'win', arch: 'x64' }), 'v24.1.0')
        .fileName,
      'node-v24.1.0-win-x64.zip',
    );
  });
});

describe('getNodeVersion', () => {
  const INDEXES: Record<string, { version: string; files: string[] }[]> = {
    [`${OFFICIAL}/index.json`]: [
      { version: 'v24.10.0', files: ['linux-x64', 'osx-arm64-tar'] },
      { version: 'v24.2.0', files: ['linux-x64', 'osx-arm64-tar'] },
      { version: 'v24.1.0', files: ['linux-x64', 'osx-arm64-tar'] },
    ],
    // unofficial-builds lags: v24.2.0 has a glibc build but no musl one yet
    [`${UNOFFICIAL}/index.json`]: [
      { version: 'v24.2.0', files: ['linux-x64-glibc-217'] },
      { version: 'v24.1.0', files: ['linux-x64-musl'] },
      { version: 'v24.0.0', files: ['linux-x64-musl'] },
    ],
  };
  const fetched: string[] = [];

  beforeEach(() => {
    fetched.length = 0;
    mock.method(globalThis, 'fetch', async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify(INDEXES[url]));
    });
  });
  afterEach(() => mock.restoreAll());

  const glibc = getNodeDist({ platform: 'linux', arch: 'x64' });
  const mac = getNodeDist({ platform: 'macos', arch: 'arm64' });
  const musl = getNodeDist({ platform: 'alpine', arch: 'x64' });

  it('picks the latest patch from the dist index', async () => {
    assert.equal(await getNodeVersion([glibc], '24'), 'v24.10.0');
    // skips v24.2.0, which lists only a glibc build
    assert.equal(await getNodeVersion([musl], '24'), 'v24.1.0');
  });

  it('matches a minor range on whole components', async () => {
    assert.equal(await getNodeVersion([glibc], '24.1'), 'v24.1.0');
  });

  it('picks the latest patch every target has a build for', async () => {
    assert.equal(await getNodeVersion([glibc, mac, musl], '24'), 'v24.1.0');
    // one fetch per release root, not per target
    assert.equal(fetched.length, 2);
  });

  it('fails when no patch covers every target', async () => {
    await assert.rejects(
      getNodeVersion([glibc, musl], '24.2'),
      /Node version 24.2 not found with a build for every target/,
    );
  });

  it('fails when a release index cannot be fetched', async () => {
    mock.method(globalThis, 'fetch', async (url: string) =>
      url.startsWith(UNOFFICIAL)
        ? new Response('', { status: 503 })
        : new Response(JSON.stringify(INDEXES[url])),
    );
    await assert.rejects(
      getNodeVersion([glibc, musl], '24'),
      /Failed to fetch node versions/,
    );
  });
});

describe('assertSingleTargetRange', () => {
  const target = (nodeRange: string) =>
    ({ nodeRange, platform: 'linux', arch: 'x64' }) as NodeTarget;

  it('accepts targets that share one range', () => {
    assert.doesNotThrow(() =>
      assertSingleTargetRange([target('node24'), target('node24')]),
    );
  });

  it('rejects mixed ranges', () => {
    assert.throws(
      () => assertSingleTargetRange([target('node22.1'), target('node22')]),
      /needs one Node.js range for all targets \(got node22.1, node22\)/,
    );
    assert.throws(
      () => assertSingleTargetRange([target('node22'), target('node24')]),
      /got node22, node24\).*run pkg once per Node major/,
    );
  });
});
