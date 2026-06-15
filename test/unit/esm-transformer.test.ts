import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeExportsForCJS,
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

  it('top-level-await + imports (no exports): extracts imports, wraps rest in IIFE', () => {
    // This is the branch where we keep imports at the top level (so esbuild
    // can rewrite them into requires) and wrap only the await-bearing body.
    // Without this split, esbuild would refuse the mix of TLA and import
    // statements at the same level.
    const src = [
      'import fs from "node:fs";',
      'const data = await fs.promises.readFile("x");',
    ].join('\n');
    const res = transformESMtoCJS(src, 'tla-imports.mjs');
    assert.equal(res.isTransformed, true);
    // esbuild rewrote the import to a require.
    assert.match(res.code, /require\(["']node:fs["']\)/);
    // IIFE wraps the await'd body (not the top-level require).
    assert.match(res.code, /async\s*\(\s*\)\s*=>/);
  });

  it('top-level for-await-of without exports: also wrapped in async IIFE', () => {
    // The detector treats `for await` identically to plain TLA.
    const src = 'for await (const x of Promise.resolve([1])) {}\n';
    const res = transformESMtoCJS(src, 'for-await.mjs');
    assert.equal(res.isTransformed, true);
    assert.match(res.code, /async\s*\(\s*\)\s*=>/);
  });

  it('top-level-await nested inside a function does NOT trigger IIFE wrap', () => {
    // The isTopLevel climber rejects await inside any Function*. Without this,
    // ordinary async functions would trip the wrapper.
    const src = ['async function f() { await 1; }', 'export default f;'].join(
      '\n',
    );
    const res = transformESMtoCJS(src, 'fn-await.mjs');
    // No TLA detected → regular esbuild transform, no IIFE. Exports are
    // allowed because we never entered the TLA branch.
    assert.equal(res.isTransformed, true);
    assert.doesNotMatch(res.code, /async\s*\(\s*\)\s*=>/);
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

describe('normalizeExportsForCJS', () => {
  it('rewrites a string target .mjs to .js', () => {
    assert.equal(normalizeExportsForCJS('./index.mjs'), './index.js');
  });

  it('adds a require condition for an import-only exports map (#281 case A)', () => {
    // esm-only: { exports: { ".": { import: "./index.mjs" } } }
    // Without a CJS-resolvable condition, require() throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED in the packaged binary.
    assert.deepEqual(
      normalizeExportsForCJS({ '.': { import: './index.mjs' } }),
      {
        '.': { require: './index.js', import: './index.js' },
      },
    );
  });

  it('rewrites .mjs require targets that no longer exist (#281 case B)', () => {
    // req-mjs: { exports: { ".": { require: "./index.mjs", import: "./index.mjs" } } }
    // The .mjs file is renamed to .js in the snapshot, so the target must follow.
    assert.deepEqual(
      normalizeExportsForCJS({
        '.': { require: './index.mjs', import: './index.mjs' },
      }),
      { '.': { require: './index.js', import: './index.js' } },
    );
  });

  it('falls back to the default condition when there is no import', () => {
    assert.deepEqual(
      normalizeExportsForCJS({ '.': { default: './index.mjs' } }),
      {
        '.': { default: './index.js' },
      },
    );
  });

  it('does not add require when a CJS-resolvable condition already exists', () => {
    // `default` is resolvable by require(), so the map is left as-is (extensions aside).
    assert.deepEqual(
      normalizeExportsForCJS({ import: './e.mjs', default: './d.mjs' }),
      { import: './e.js', default: './d.js' },
    );
  });

  it('recurses through subpath maps and nested conditions', () => {
    assert.deepEqual(
      normalizeExportsForCJS({
        '.': { import: './i.mjs' },
        './sub': { node: { import: './sub.mjs' } },
      }),
      {
        '.': { require: './i.js', import: './i.js' },
        './sub': { node: { require: './sub.js', import: './sub.js' } },
      },
    );
  });

  it('handles array targets', () => {
    assert.deepEqual(normalizeExportsForCJS(['./a.mjs', './b.mjs']), [
      './a.js',
      './b.js',
    ]);
  });
});
