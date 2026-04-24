import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  rewriteMjsRequirePaths,
  transformESMtoCJS,
} from '../../lib/esm-transformer';

describe('rewriteMjsRequirePaths', () => {
  it('rewrites relative ./foo.mjs to ./foo.js', () => {
    const src = 'const x = require("./foo.mjs");';
    assert.equal(rewriteMjsRequirePaths(src), 'const x = require("./foo.js");');
  });

  it('handles single and double quotes', () => {
    assert.equal(
      rewriteMjsRequirePaths("require('./a.mjs');"),
      "require('./a.js');",
    );
    assert.equal(
      rewriteMjsRequirePaths('require("./a.mjs");'),
      'require("./a.js");',
    );
  });

  it('handles parent-relative paths', () => {
    assert.equal(
      rewriteMjsRequirePaths('require("../x/y.mjs");'),
      'require("../x/y.js");',
    );
  });

  it('leaves bare-specifier .mjs requires alone (not relative)', () => {
    // Only `./…` and `../…` paths are rewritten; bare specifiers refer to
    // installed packages and must not be touched.
    const src = 'require("some-pkg/foo.mjs");';
    assert.equal(rewriteMjsRequirePaths(src), src);
  });

  it('rewrites every occurrence in a multi-require file', () => {
    const src = 'require("./a.mjs");\nrequire("./b.mjs");\nrequire("./c.cjs");';
    assert.equal(
      rewriteMjsRequirePaths(src),
      'require("./a.js");\nrequire("./b.js");\nrequire("./c.cjs");',
    );
  });
});

describe('transformESMtoCJS', () => {
  it('short-circuits on non-JS files (returns input untransformed)', () => {
    const src = '{ "name": "x" }';
    const res = transformESMtoCJS(src, 'pkg.json');
    assert.equal(res.isTransformed, false);
    assert.equal(res.code, src);
  });

  it('transforms a plain ESM import to CJS require', () => {
    const res = transformESMtoCJS(
      'import assert from "node:assert";\nassert.equal(1, 1);\n',
      'a.mjs',
    );
    assert.equal(res.isTransformed, true);
    assert.match(res.code, /require\(["']node:assert["']\)/);
  });

  it('transforms ESM default + named exports', () => {
    const res = transformESMtoCJS(
      'export const x = 1;\nexport default 42;\n',
      'a.mjs',
    );
    assert.equal(res.isTransformed, true);
    // esbuild emits module.exports / exports.X shapes — just confirm CJS
    // surface marks are present, not the exact emission.
    assert.match(res.code, /exports|module\.exports/);
  });

  it('top-level-await + exports: refuses to wrap, returns source untransformed', () => {
    // Wrapping in async IIFE would break sync export semantics.
    const src = 'const v = await Promise.resolve(1);\nexport default v;\n';
    const res = transformESMtoCJS(src, 'entry.mjs');
    assert.equal(res.isTransformed, false);
    assert.equal(res.code, src);
  });

  it('top-level-await without exports: wraps in async IIFE and transforms', () => {
    const src = 'await Promise.resolve(1);\n';
    const res = transformESMtoCJS(src, 'side-effects.mjs');
    assert.equal(res.isTransformed, true);
    // The async-IIFE wrapper survives esbuild (it's not an ESM construct).
    assert.match(res.code, /async\s*\(\s*\)\s*=>/);
  });

  it('import.meta: esbuild emits shim, we inject the real implementation', () => {
    const res = transformESMtoCJS(
      'export const here = import.meta.url;\n',
      'probe.mjs',
    );
    assert.equal(res.isTransformed, true);
    // The empty `const import_meta = {}` stub gets replaced with the
    // getter-based shim pointing at __filename / __dirname.
    assert.match(res.code, /pathToFileURL\(__filename\)\.href/);
    assert.doesNotMatch(res.code, /const import_meta\s*=\s*\{\s*\};/);
  });

  it('surfaces esbuild failures as isTransformed=false without throwing', () => {
    const res = transformESMtoCJS('let x = ;', 'broken.mjs');
    assert.equal(res.isTransformed, false);
    // Original source is returned unchanged on failure.
    assert.equal(res.code, 'let x = ;');
  });
});
