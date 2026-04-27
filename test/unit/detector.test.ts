import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type * as babelTypes from '@babel/types';

import {
  detect,
  parse,
  visitorMalformed,
  visitorNonLiteral,
  visitorSuccessful,
  visitorUseSCWD,
} from '../../lib/detector';
import { log } from '../../lib/log';

// Test-only helper: parse `src`, collect CallExpression / ImportDeclaration /
// ImportExpression nodes, and return the first one. Matches how walker.ts
// feeds nodes into the visitors — we exercise the real code path, not a
// synthesized AST fragment.
function firstRelevantNode(
  src: string,
  isEsm = false,
): babelTypes.Node | undefined {
  const kinds = new Set([
    'CallExpression',
    'NewExpression',
    'ImportDeclaration',
    'ImportExpression',
    'ExportAllDeclaration',
    'ExportNamedDeclaration',
  ]);
  let hit: babelTypes.Node | undefined;
  detect(
    src,
    (node) => {
      if (!hit && kinds.has(node.type)) {
        hit = node;
      }
      return true;
    },
    undefined,
    isEsm,
  );
  return hit;
}

// Test-only helper: collect every successful-derivative the walker would emit
// for `src`. Mirrors stepDetect's exact threading of `requireAliases` through
// the visitor (3rd arg of detect's callback), so per-file alias state is
// applied — `r("./foo")` after `const r = createRequire(...)` resolves
// the same way it would in production.
function collectDerivatives(src: string, isEsm = false) {
  const out: Array<{ alias: string; aliasType: number }> = [];
  detect(
    src,
    (node, _trying, requireAliases) => {
      const d = visitorSuccessful(node, false, requireAliases) as {
        alias?: string;
        aliasType?: number;
      } | null;

      if (d && typeof d.alias === 'string') {
        out.push({ alias: d.alias, aliasType: d.aliasType ?? -1 });
        return false;
      }

      return true;
    },
    undefined,
    isEsm,
  );
  return out;
}

describe('parse', () => {
  it('CJS sources parse cleanly in script mode (default)', () => {
    const ast = parse('const x = require("foo");');
    assert.equal(ast.type, 'File');
  });

  it('ESM sources need isEsm=true for import statements', () => {
    // Tolerant flags allow top-level `import` to parse even in script mode
    // (allowImportExportEverywhere); this test pins that both modes accept it.
    assert.doesNotThrow(() => parse('import x from "foo";', true));
    assert.doesNotThrow(() => parse('import x from "foo";', false));
  });

  it('accepts decorator-legacy syntax without throwing', () => {
    // Regression guard for #264: raw decorators used to abort parse and
    // silently drop the file's dependency graph.
    assert.doesNotThrow(() => parse('@dec class X { @method m() {} }', false));
  });

  it('accepts top-level return and import.meta (tolerant flags)', () => {
    assert.doesNotThrow(() => parse('return 42;'));
    assert.doesNotThrow(() => parse('console.log(import.meta.url);', true));
  });
});

describe('detect', () => {
  it('walks nodes and yields ImportDeclaration when isEsm=true', () => {
    const types: string[] = [];
    detect(
      'import x from "foo";',
      (node) => {
        types.push(node.type);
        return true;
      },
      undefined,
      true,
    );
    assert.ok(types.includes('ImportDeclaration'));
  });

  it('swallows parse errors (warns, does not throw)', () => {
    const original = log.warn;
    const warns: string[] = [];
    log.warn = ((...a: unknown[]) => {
      warns.push(a.join(' '));
    }) as typeof log.warn;
    try {
      assert.doesNotThrow(() =>
        detect('this is not valid (((', () => true, 'broken.js'),
      );
      assert.ok(
        warns.some((w) => /Babel parse has failed/.test(w)),
        `expected a parse-failure warning, got: ${warns.join('|')}`,
      );
    } finally {
      log.warn = original;
    }
  });

  it('stops descending when visitor returns falsy', () => {
    // The walker visits the root `File` node first; refusing descent there
    // means `Program` is never queued, so the visitor is called exactly once.
    let visited = 0;
    detect('const x = require("foo");', () => {
      visited += 1;
      return false;
    });
    assert.equal(visited, 1);
  });

  it('descends one level per truthy return', () => {
    // Descend through `File`, refuse at `Program` — visitor sees both
    // (count = 2) but no statements inside the Program body.
    let visited = 0;
    const seen: string[] = [];
    detect('const x = require("foo");', (node) => {
      visited += 1;
      seen.push(node.type);
      return node.type !== 'Program';
    });
    assert.equal(visited, 2);
    assert.deepEqual(seen, ['File', 'Program']);
  });
});

describe('visitorSuccessful', () => {
  it('picks up require("lit")', () => {
    const node = firstRelevantNode('require("foo");');
    const out = visitorSuccessful(node!);
    assert.deepEqual(out, {
      alias: 'foo',
      aliasType: 1, // ALIAS_AS_RESOLVABLE
      mustExclude: false,
      mayExclude: false,
    });
  });

  it('picks up require.resolve("lit")', () => {
    const node = firstRelevantNode('require.resolve("foo");');
    assert.deepEqual(visitorSuccessful(node!), {
      alias: 'foo',
      aliasType: 1,
      mustExclude: false,
      mayExclude: false,
    });
  });

  it('picks up static ESM import', () => {
    const node = firstRelevantNode('import x from "foo";', true);
    const out = visitorSuccessful(node!) as {
      alias: string;
      aliasType: number;
    };
    assert.equal(out.alias, 'foo');
    assert.equal(out.aliasType, 1);
  });

  it('honours must-exclude / may-exclude hints', () => {
    const mustNode = firstRelevantNode('require("foo", "must-exclude");');
    assert.deepEqual(visitorSuccessful(mustNode!), {
      alias: 'foo',
      aliasType: 1,
      mustExclude: true,
      mayExclude: false,
    });

    const mayNode = firstRelevantNode('require("foo", "may-exclude");');
    assert.deepEqual(visitorSuccessful(mayNode!), {
      alias: 'foo',
      aliasType: 1,
      mustExclude: false,
      mayExclude: true,
    });
  });

  it('rejects unknown 2nd-arg markers', () => {
    const node = firstRelevantNode('require("foo", "random");');
    assert.equal(visitorSuccessful(node!), null);
  });

  it('picks up path.join(__dirname, "lit") as ALIAS_AS_RELATIVE', () => {
    const node = firstRelevantNode('path.join(__dirname, "asset.txt");');
    assert.deepEqual(visitorSuccessful(node!), {
      alias: 'asset.txt',
      aliasType: 0, // ALIAS_AS_RELATIVE
      mayExclude: false,
    });
  });

  it('joins multi-arg path.join(__dirname, "a", "b", "c") into one alias (regression: #269)', () => {
    // Pre-fix: `n.arguments.length === 2` gate dropped 3+ segment joins
    // silently, so `path.join(__dirname, "data", "files", "x.json")` never
    // reached the walker. Post-fix: segments concat to a single posix alias.
    const node = firstRelevantNode(
      'path.join(__dirname, "data", "files", "x.json");',
    );
    assert.deepEqual(visitorSuccessful(node!), {
      alias: 'data/files/x.json',
      aliasType: 0,
      mayExclude: false,
    });
  });

  it('picks up path.resolve(__dirname, "lit") as ALIAS_AS_RELATIVE (regression: #269)', () => {
    // Pre-fix: visitorPathJoin only matched `path.join`, so the equally common
    // `path.resolve(__dirname, …)` form was silently dropped.
    const node = firstRelevantNode('path.resolve(__dirname, "asset.txt");');
    assert.deepEqual(visitorSuccessful(node!), {
      alias: 'asset.txt',
      aliasType: 0,
      mayExclude: false,
    });
  });

  it('joins multi-arg path.resolve(__dirname, "a", "b") into one alias', () => {
    const node = firstRelevantNode('path.resolve(__dirname, "a", "b.txt");');
    assert.deepEqual(visitorSuccessful(node!), {
      alias: 'a/b.txt',
      aliasType: 0,
      mayExclude: false,
    });
  });

  it('bails out when any path.join segment is non-literal (would synthesize wrong path)', () => {
    // `path.join(__dirname, "a", x)` — `x` could be anything at runtime, so
    // we can't pre-bundle a known asset. Treat as no-match rather than
    // guessing.
    const node = firstRelevantNode('path.join(__dirname, "a", x);');
    assert.equal(visitorSuccessful(node!), null);
  });

  it('picks up new URL("./rel", import.meta.url) as ALIAS_AS_RELATIVE (regression: #269)', () => {
    const node = firstRelevantNode(
      'const u = new URL("./asset.txt", import.meta.url);',
      true,
    );
    assert.deepEqual(visitorSuccessful(node!), {
      alias: './asset.txt',
      aliasType: 0,
      mayExclude: false,
    });
  });

  it('ignores new URL with a non-import.meta.url base', () => {
    // Bare-URL or string-base forms don't resolve to a snapshot path; only
    // import.meta.url is a portable sibling-asset idiom.
    const node = firstRelevantNode(
      'const u = new URL("./asset.txt", "https://example.com/");',
      true,
    );
    assert.equal(visitorSuccessful(node!), null);
  });

  it('ignores plain new URL(specifier) (no base, runtime-resolved)', () => {
    const node = firstRelevantNode(
      'const u = new URL("https://example.com/foo");',
      true,
    );
    assert.equal(visitorSuccessful(node!), null);
  });

  it('picks up import.meta.resolve("lit") as ALIAS_AS_RESOLVABLE (regression: #269)', () => {
    const node = firstRelevantNode('import.meta.resolve("lit");', true);
    assert.deepEqual(visitorSuccessful(node!), {
      alias: 'lit',
      aliasType: 1, // ALIAS_AS_RESOLVABLE
    });
  });

  it('picks up `export * from "lit"` (regression: #269)', () => {
    // ESM re-exports were silently dropped: `visitorImport` only matched
    // `ImportDeclaration`, not `ExportAllDeclaration` / `ExportNamedDeclaration`
    // with `.source`. SEA mode skips the ESM→CJS transform that handled them
    // separately, so barrel files lost their re-exports entirely.
    const derivs = collectDerivatives('export * from "lit";', true);
    assert.deepEqual(derivs, [{ alias: 'lit', aliasType: 1 }]);
  });

  it('picks up `export { x } from "lit"` (named re-export)', () => {
    const derivs = collectDerivatives('export { x } from "lit";', true);
    assert.deepEqual(derivs, [{ alias: 'lit', aliasType: 1 }]);
  });

  it('picks up `export * as ns from "lit"` (namespace re-export)', () => {
    const derivs = collectDerivatives('export * as ns from "lit";', true);
    assert.deepEqual(derivs, [{ alias: 'lit', aliasType: 1 }]);
  });

  it('ignores `export const x = 1` (no source — not a re-export)', () => {
    const derivs = collectDerivatives('export const x = 1;', true);
    assert.deepEqual(derivs, []);
  });

  it('picks up createRequire(import.meta.url)("./foo") direct invocation (regression: #269)', () => {
    // Outer CallExpression's callee is itself a CallExpression — visitorRequire
    // pre-fix only matched Identifier callees, so the direct form silently
    // dropped its target.
    const derivs = collectDerivatives(
      'import { createRequire } from "module";\n' +
        'createRequire(import.meta.url)("./foo");',
      true,
    );
    assert.ok(
      derivs.some((d) => d.alias === './foo' && d.aliasType === 1),
      `expected ./foo alias from createRequire(...) call, got ${JSON.stringify(derivs)}`,
    );
  });

  it('picks up `r("./foo")` after const r = createRequire(import.meta.url) (regression: #269)', () => {
    // The aliased form requires per-file scope tracking — collectRequireAliases
    // pre-scans the AST and threads the bound names into the visitor.
    const src =
      'import { createRequire } from "module";\n' +
      'const r = createRequire(import.meta.url);\n' +
      'r("./foo");';
    const derivs = collectDerivatives(src, true);
    assert.ok(
      derivs.some((d) => d.alias === './foo' && d.aliasType === 1),
      `expected ./foo alias via r(...), got ${JSON.stringify(derivs)}`,
    );
  });

  it('picks up `r.resolve("foo")` after const r = createRequire(...) (alias propagates to require.resolve too)', () => {
    const src =
      'import { createRequire } from "module";\n' +
      'const r = createRequire(import.meta.url);\n' +
      'r.resolve("foo");';
    const derivs = collectDerivatives(src, true);
    assert.ok(
      derivs.some((d) => d.alias === 'foo' && d.aliasType === 1),
      `expected foo alias via r.resolve, got ${JSON.stringify(derivs)}`,
    );
  });

  it('does not treat unrelated identifiers as require aliases', () => {
    // Sanity check: `r` here is bound to something other than createRequire,
    // so r("./foo") must NOT be picked up.
    const src = 'const r = somethingElse(); r("./foo");';
    const derivs = collectDerivatives(src);
    assert.equal(
      derivs.length,
      0,
      `expected nothing, got ${JSON.stringify(derivs)}`,
    );
  });

  it('test=true renders a printable form', () => {
    const node = firstRelevantNode('require("foo");');
    assert.equal(visitorSuccessful(node!, true), 'require("foo")');
  });

  it('returns null for non-matching shapes', () => {
    const node = firstRelevantNode('console.log("hi");');
    assert.equal(visitorSuccessful(node!), null);
  });
});

describe('visitorNonLiteral', () => {
  it('captures require(dynamicExpr)', () => {
    const node = firstRelevantNode('require(mod);');
    const out = visitorNonLiteral(node!) as { alias: string };
    assert.equal(out.alias, 'mod');
  });

  it('captures require.resolve(dynamicExpr)', () => {
    const node = firstRelevantNode('require.resolve(name);');
    const out = visitorNonLiteral(node!) as { alias: string };
    assert.equal(out.alias, 'name');
  });

  it('includes must-exclude hint when provided', () => {
    const node = firstRelevantNode('require(name, "must-exclude");');
    const out = visitorNonLiteral(node!) as {
      alias: string;
      mustExclude: boolean;
    };
    assert.equal(out.alias, 'name');
    assert.equal(out.mustExclude, true);
  });

  it('returns null for literal requires (let visitorSuccessful handle those)', () => {
    const node = firstRelevantNode('require("foo");');
    assert.equal(visitorNonLiteral(node!), null);
  });
});

describe('visitorMalformed', () => {
  it('flags require() with no args as null (nothing to reconstruct)', () => {
    const node = firstRelevantNode('require();');
    assert.equal(visitorMalformed(node!), null);
  });

  it('returns alias for require.resolve(expr) with any shape', () => {
    const node = firstRelevantNode('require.resolve(fn());');
    const out = visitorMalformed(node!) as { alias: string };
    assert.ok(out && typeof out.alias === 'string');
  });

  it('returns alias for require(expr) with a dynamic arg', () => {
    // Dynamic-arg requires are picked up by this visitor when the more
    // specific visitorNonLiteral matcher in walker doesn't claim them —
    // the reconstruct() helper renders the expression back to source.
    const node = firstRelevantNode('require(pickModule());');
    const out = visitorMalformed(node!) as { alias: string };
    assert.match(out.alias, /pickModule\(\)/);
  });

  it('ignores unrelated calls', () => {
    const node = firstRelevantNode('lookup("foo");');
    assert.equal(visitorMalformed(node!), null);
  });
});

describe('visitorUseSCWD', () => {
  it('flags path.resolve(...) calls', () => {
    const node = firstRelevantNode('path.resolve("foo", "bar");');
    const out = visitorUseSCWD(node!) as { alias: string };
    assert.ok(out);
    assert.match(out.alias, /"foo"/);
  });

  it('reconstructs all args joined by comma', () => {
    const node = firstRelevantNode('path.resolve("a", base, "b", fn());');
    const out = visitorUseSCWD(node!) as { alias: string };
    // Each arg is rendered back to source and joined; internal spacing may
    // vary, so match each element independently.
    assert.match(out.alias, /"a"/);
    assert.match(out.alias, /base/);
    assert.match(out.alias, /"b"/);
    assert.match(out.alias, /fn\(\)/);
  });

  it('fires with zero args too (returns an empty-string alias)', () => {
    // Edge case: the visitor doesn't short-circuit on empty args.
    const node = firstRelevantNode('path.resolve();');
    const out = visitorUseSCWD(node!) as { alias: string };
    assert.equal(out.alias, '');
  });

  it('ignores path.join (similar shape, different semantics)', () => {
    const node = firstRelevantNode('path.join("foo", "bar");');
    assert.equal(visitorUseSCWD(node!), null);
  });

  it('ignores resolve() called on an object that is not `path`', () => {
    const node = firstRelevantNode('url.resolve("a", "b");');
    assert.equal(visitorUseSCWD(node!), null);
  });

  it('ignores the bare function call resolve()', () => {
    const node = firstRelevantNode('resolve("foo");');
    assert.equal(visitorUseSCWD(node!), null);
  });

  it('skips path.resolve(__dirname, …) — that case is already bundled (regression: #269)', () => {
    // visitorPathJoin claims this shape and returns ALIAS_AS_RELATIVE, so
    // visitorUseSCWD must NOT also fire — otherwise we'd warn that the call
    // is "ambiguous" while simultaneously bundling its target. Pre-fix the
    // walker emitted exactly that contradictory pair.
    const node = firstRelevantNode('path.resolve(__dirname, "asset.txt");');
    assert.equal(visitorUseSCWD(node!), null);
  });
});
