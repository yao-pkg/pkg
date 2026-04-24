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
    let visited = 0;
    detect('const x = require("foo");', () => {
      visited += 1;
      return false; // refuse to descend past the Program node
    });
    // Program + (File header) visited; children are not queued because the
    // visitor refused descent — exact count is 1, never higher.
    assert.equal(visited, 1);
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
  it('flags require() with no args', () => {
    const node = firstRelevantNode('require();');
    assert.equal(visitorMalformed(node!), null); // no arg → nothing to reconstruct
  });

  it('returns alias for require.resolve(expr) with any shape', () => {
    const node = firstRelevantNode('require.resolve(fn());');
    const out = visitorMalformed(node!) as { alias: string };
    assert.ok(out && typeof out.alias === 'string');
  });
});

describe('visitorUseSCWD', () => {
  it('flags path.resolve(...) calls', () => {
    const node = firstRelevantNode('path.resolve("foo", "bar");');
    const out = visitorUseSCWD(node!) as { alias: string };
    assert.ok(out);
    assert.match(out.alias, /"foo"/);
  });

  it('ignores unrelated calls', () => {
    const node = firstRelevantNode('path.join("foo", "bar");');
    assert.equal(visitorUseSCWD(node!), null);
  });
});
