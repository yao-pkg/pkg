import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { system } from '@yao-pkg/pkg-fetch';

import { fabricateViaFile } from '../../lib/fabricator';
import type { Target } from '../../lib/types';

// The file-based fabricator IPC exists so a cross-OS fabricator (a Windows Node
// under Wine) can exchange the snap/body and the resulting V8 cached data
// without inherited stdin/stdout pipes. Wine itself can't run here, so this
// proves the file protocol independently using the HOST Node as the fabricator
// (platform === hostPlatform, so no Wine path/env translation is applied).
describe('fabricateViaFile (host Node, no Wine)', () => {
  const hostFabricator = {
    nodeRange: `node${process.version.match(/^v(\d+)/)![1]}`,
    platform: system.hostPlatform,
    arch: system.hostArch,
    binaryPath: process.execPath,
  } as unknown as Target;

  it('round-trips a body into a non-empty cached-data blob', () => {
    const snap = '/snapshot/test/app.js';
    const body = Buffer.from(
      'module.exports = function () { return 40 + 2; };\n',
    );

    let err: Error | undefined;
    let blob: Buffer | undefined;
    fabricateViaFile([], hostFabricator, snap, body, (e, b) => {
      err = e;
      blob = b;
    });

    assert.equal(err, undefined, err && err.message);
    assert.ok(
      blob && blob.length > 0,
      'expected a non-empty V8 cached-data blob',
    );
  });

  it('reports a descriptive error when the fabricator cannot execute', () => {
    const broken = {
      ...hostFabricator,
      binaryPath: '/path/that/does/not/exist/node',
    } as unknown as Target;

    let err: Error | undefined;
    fabricateViaFile([], broken, '/snapshot/x.js', Buffer.from('1;\n'), (e) => {
      err = e;
    });

    assert.ok(err, 'expected an error');
    assert.match(err!.message, /Failed to make bytecode/);
  });
});
