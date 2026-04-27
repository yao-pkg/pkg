import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { log } from '../../lib/log';
import { runPostBuild, runPreBuild, runTransform } from '../../lib/hooks';
import { STORE_BLOB, STORE_CONTENT, STORE_LINKS } from '../../lib/common';
import type { FileRecords, PkgOptions } from '../../lib/types';

type LogFn = (..._a: unknown[]) => void;
let originals: { info: LogFn; warn: LogFn; error: LogFn };

beforeEach(() => {
  originals = {
    info: log.info as LogFn,
    warn: log.warn as LogFn,
    error: log.error as LogFn,
  };
  log.info = (() => {}) as typeof log.info;
  log.warn = (() => {}) as typeof log.warn;
  log.error = (() => {}) as typeof log.error;
});

afterEach(() => {
  log.info = originals.info as typeof log.info;
  log.warn = originals.warn as typeof log.warn;
  log.error = originals.error as typeof log.error;
});

describe('runPreBuild', () => {
  it('no-op when not set', async () => {
    await runPreBuild({} as PkgOptions);
  });

  it('invokes function form', async () => {
    let called = 0;
    await runPreBuild({ preBuild: () => void called++ } as PkgOptions);
    assert.equal(called, 1);
  });

  it('awaits async function form', async () => {
    let resolved = false;
    await runPreBuild({
      preBuild: async () => {
        await new Promise((r) => setTimeout(r, 5));
        resolved = true;
      },
    } as PkgOptions);
    assert.equal(resolved, true);
  });

  it('rethrows function-form errors', async () => {
    await assert.rejects(
      runPreBuild({
        preBuild: () => {
          throw new Error('boom');
        },
      } as PkgOptions),
      /boom/,
    );
  });

  it('shell form: success exits 0', async () => {
    await runPreBuild({ preBuild: 'true' } as PkgOptions);
  });

  it('shell form: non-zero exit throws with hook name', async () => {
    await assert.rejects(
      runPreBuild({ preBuild: 'exit 7' } as PkgOptions),
      /preBuild hook failed.*exit code 7/,
    );
  });
});

describe('runPostBuild', () => {
  it('no-op when not set', async () => {
    await runPostBuild({} as PkgOptions, '/tmp/bin');
  });

  it('function form receives output path', async () => {
    let received: string | undefined;
    await runPostBuild(
      {
        postBuild: (out: string) => {
          received = out;
        },
      } as PkgOptions,
      '/tmp/my-bin',
    );
    assert.equal(received, '/tmp/my-bin');
  });

  it('shell form sees PKG_OUTPUT env', async () => {
    // Smoke test using a portable shell-ism that succeeds only when
    // PKG_OUTPUT is set. printenv emits the value or returns 1 on miss.
    await runPostBuild(
      {
        postBuild:
          process.platform === 'win32'
            ? 'if "%PKG_OUTPUT%"=="" (exit 1)'
            : 'test -n "$PKG_OUTPUT"',
      } as PkgOptions,
      '/tmp/seen',
    );
  });
});

describe('runTransform', () => {
  function makeRecords(): FileRecords {
    return {
      '/snap/a.js': {
        file: '/abs/a.js',
        body: Buffer.from('original'),
        [STORE_BLOB]: true,
      },
      '/snap/b.json': {
        file: '/abs/b.json',
        body: '{"k":1}',
        [STORE_CONTENT]: true,
      },
      // No body and no STORE_BLOB/STORE_CONTENT — should be skipped.
      '/snap/dir': {
        file: '/abs/dir',
        [STORE_LINKS]: ['a.js'],
      },
    };
  }

  it('no-op when transform not set', async () => {
    const records = makeRecords();
    await runTransform({} as PkgOptions, records);
    assert.equal(records['/snap/a.js'].body!.toString(), 'original');
  });

  it('skips records without a content store', async () => {
    const records = makeRecords();
    const seen: string[] = [];
    await runTransform(
      {
        transform: (file: string) => {
          seen.push(file);
        },
      } as PkgOptions,
      records,
    );
    assert.deepEqual(seen.sort(), ['/abs/a.js', '/abs/b.json']);
  });

  it('replaces body when transform returns a string', async () => {
    const records = makeRecords();
    await runTransform(
      {
        transform: (_file: string, contents: Buffer | string) => {
          return contents.toString().toUpperCase();
        },
      } as PkgOptions,
      records,
    );
    assert.equal(records['/snap/a.js'].body, 'ORIGINAL');
    assert.equal(records['/snap/b.json'].body, '{"K":1}');
  });

  it('replaces body when transform returns a Buffer', async () => {
    const records = makeRecords();
    await runTransform(
      {
        transform: () => Buffer.from([1, 2, 3]),
      } as PkgOptions,
      records,
    );
    const out = records['/snap/a.js'].body as Buffer;
    assert.ok(Buffer.isBuffer(out));
    assert.deepEqual([...out], [1, 2, 3]);
  });

  it('keeps original body when transform returns undefined', async () => {
    const records = makeRecords();
    await runTransform({ transform: () => undefined } as PkgOptions, records);
    assert.equal(records['/snap/a.js'].body!.toString(), 'original');
  });

  it('rejects non-Buffer/non-string return', async () => {
    const records = makeRecords();
    await assert.rejects(
      runTransform(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { transform: () => 42 as any } as PkgOptions,
        records,
      ),
      /transform hook for "\/abs\/a\.js" returned number/,
    );
  });

  it('async transform is awaited', async () => {
    const records = makeRecords();
    await runTransform(
      {
        transform: async (_file: string, contents: Buffer | string) => {
          await new Promise((r) => setTimeout(r, 1));
          return `[${contents.toString()}]`;
        },
      } as PkgOptions,
      records,
    );
    assert.equal(records['/snap/a.js'].body, '[original]');
  });

  it('user errors surface with the file path', async () => {
    const records = makeRecords();
    await assert.rejects(
      runTransform(
        {
          transform: () => {
            throw new Error('user died');
          },
        } as PkgOptions,
        records,
      ),
      /transform hook threw for "\/abs\/a\.js": user died/,
    );
  });
});
