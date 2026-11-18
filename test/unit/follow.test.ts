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
      JSON.stringify({
        name: 'app',
        imports: { '#util': './util.js', '#dep': 'some-dep' },
      }),
    );
    fs.writeFileSync(path.join(root, 'util.js'), 'module.exports = 1;');
    const dep = path.join(root, 'node_modules', 'some-dep');
    fs.mkdirSync(dep, { recursive: true });
    fs.writeFileSync(path.join(dep, 'package.json'), '{"name":"some-dep"}');
    fs.writeFileSync(path.join(dep, 'index.js'), 'module.exports = 2;');
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

  it('resolves a bare package target from node_modules', async () => {
    assert.equal(
      await follow('#dep', { basedir: root }),
      path.join(root, 'node_modules', 'some-dep', 'index.js'),
    );
  });

  it('rejects an unmapped specifier', async () => {
    await assert.rejects(follow('#missing', { basedir: root }));
  });
});
