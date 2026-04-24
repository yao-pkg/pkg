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
    'ImportDeclaration',
    'ImportExpression',
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
});
