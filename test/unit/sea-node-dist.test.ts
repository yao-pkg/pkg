import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { getNodeArchive, getNodeDist, getNodeVersion } from '../../lib/sea';

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
    assert.throws(
      () => getNodeDist({ platform: 'alpine', arch: 'riscv64' }),
      /Unsupported architecture for alpine: riscv64/,
    );
  });

  it('rejects linuxstatic, which has no node archive', () => {
    assert.throws(
      () => getNodeDist({ platform: 'linuxstatic', arch: 'x64' }),
      /Unsupported OS: linuxstatic/,
    );
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
      { version: 'v24.2.0', files: ['linux-x64', 'osx-arm64-tar'] },
      { version: 'v24.1.0', files: ['linux-x64', 'osx-arm64-tar'] },
    ],
    // unofficial-builds lags: no v24.2.0 yet
    [`${UNOFFICIAL}/index.json`]: [
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
    assert.equal(await getNodeVersion([glibc], '24'), 'v24.2.0');
    assert.equal(await getNodeVersion([musl], '24'), 'v24.1.0');
    assert.deepEqual(fetched, [
      `${OFFICIAL}/index.json`,
      `${UNOFFICIAL}/index.json`,
    ]);
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

  it('returns a full version without fetching', async () => {
    assert.equal(await getNodeVersion([glibc, musl], '24.9.9'), 'v24.9.9');
    assert.equal(fetched.length, 0);
  });
});
