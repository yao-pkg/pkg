import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { follow } from '../../lib/follow';

describe('follow with "#" specifiers', () => {
  let root: string;

  before(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-follow-imports-')),
    );
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'app', imports: { '#util': './util.js' } }),
    );
    fs.writeFileSync(path.join(root, 'util.js'), 'module.exports = 1;');
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves a mapped specifier to its target', async () => {
    assert.equal(
      await follow('#util', { basedir: root }),
      path.join(root, 'util.js'),
    );
  });

  it('rejects an unmapped specifier', async () => {
    await assert.rejects(follow('#missing', { basedir: root }));
  });
});
