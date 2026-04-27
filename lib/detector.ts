import path from 'path';
import * as babelTypes from '@babel/types';
import * as babel from '@babel/parser';
import generate from '@babel/generator';
import { log } from './log';

import { ALIAS_AS_RELATIVE, ALIAS_AS_RESOLVABLE } from './common';

/** Type guard for plain literal nodes; rejects template literals with interpolations. */
function isLiteral(node: babelTypes.Node): node is babelTypes.Literal {
  if (node == null) {
    return false;
  }

  if (!node.type.endsWith('Literal')) {
    return false;
  }

  if (node.type === 'TemplateLiteral' && node.expressions.length !== 0) {
    return false;
  }

  return true;
}

/** Extracts the runtime value of a literal. Throws on null/regexp — never valid module specifiers. */
function getLiteralValue(node: babelTypes.Literal) {
  if (node.type === 'TemplateLiteral') {
    return node.quasis[0].value.raw;
  }

  if (node.type === 'NullLiteral') {
    throw new Error('Unexpected null in require expression');
  }

  if (node.type === 'RegExpLiteral') {
    throw new Error('Unexpected regexp in require expression');
  }

  return node.value;
}

/** Renders an import specifier list back to source (`a, { b, c as d }`) for log output. */
function reconstructSpecifiers(
  specs: (
    | babelTypes.ImportDefaultSpecifier
    | babelTypes.ImportNamespaceSpecifier
    | babelTypes.ImportSpecifier
  )[],
) {
  if (!specs || !specs.length) {
    return '';
  }

  const defaults = [];

  for (const spec of specs) {
    if (babelTypes.isImportDefaultSpecifier(spec)) {
      defaults.push(spec.local.name);
    }
  }

  const nonDefaults = [];

  for (const spec of specs) {
    if (babelTypes.isImportSpecifier(spec)) {
      const importedName = babelTypes.isIdentifier(spec.imported)
        ? spec.imported.name
        : spec.imported.value;

      if (spec.local.name === importedName) {
        nonDefaults.push(spec.local.name);
      } else {
        nonDefaults.push(`${importedName} as ${spec.local.name}`);
      }
    }
  }

  if (nonDefaults.length) {
    defaults.push(`{ ${nonDefaults.join(', ')} }`);
  }

  return defaults.join(', ');
}

/** Prints any AST node back to a single-line source string, used when an arg isn't a literal. */
function reconstruct(node: babelTypes.Node) {
  let v = generate(node, { comments: false }).code.replace(/\n/g, '');
  let v2;

  while (true) {
    v2 = v.replace(/\[ /g, '[').replace(/ \]/g, ']').replace(/ {2}/g, ' ');

    if (v2 === v) {
      break;
    }

    v = v2;
  }

  return v2;
}

interface Was {
  v1: string | number | boolean;
  v2?: string | number | boolean | null;
  v3?: string;
}

/** Fills a template (e.g. `require({v1}{c2}{v2})`) with captured args to produce the printable form of a match. */
function forge(pattern: string, was: Was) {
  return pattern
    .replace('{c1}', ', ')
    .replace('{v1}', `"${was.v1}"`)
    .replace('{c2}', was.v2 ? ', ' : '')
    .replace('{v2}', was.v2 ? `"${was.v2}"` : '')
    .replace('{c3}', was.v3 ? ' from ' : '')
    .replace('{v3}', was.v3 ? was.v3 : '');
}

/** Guards the 2nd arg of require/require.resolve — only pkg's `must-exclude`/`may-exclude` markers are honored. */
function valid2(v2?: Was['v2']) {
  return (
    v2 === undefined ||
    v2 === null ||
    v2 === 'must-exclude' ||
    v2 === 'may-exclude'
  );
}

/**
 * True if `n` is a `createRequire(...)` call. Used both to detect the direct
 * `createRequire(import.meta.url)('./foo')` invocation pattern and to seed the
 * alias set with names bound to its result.
 */
function isCreateRequireCall(n: babelTypes.Node | null | undefined) {
  return (
    !!n &&
    babelTypes.isCallExpression(n) &&
    babelTypes.isIdentifier(n.callee) &&
    n.callee.name === 'createRequire'
  );
}

/**
 * True if `name` resolves to a `require`-equivalent in the current file —
 * either the literal `require` or a local bound to `createRequire(...)` (e.g.
 * `const r = createRequire(import.meta.url)`). The name set is collected by
 * `collectRequireAliases` before traversal, so visitor lookups are O(1).
 */
function isRequireName(name: string, requireAliases?: Set<string>) {
  return name === 'require' || !!requireAliases?.has(name);
}

/** Matches `require.resolve("lit"[, "lit"])`. Returns captured args or null. */
function visitorRequireResolve(
  n: babelTypes.Node,
  requireAliases?: Set<string>,
) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  if (!babelTypes.isMemberExpression(n.callee)) {
    return null;
  }

  const ci =
    n.callee.object.type === 'Identifier' &&
    isRequireName(n.callee.object.name, requireAliases) &&
    n.callee.property.type === 'Identifier' &&
    n.callee.property.name === 'resolve';

  if (!ci) {
    return null;
  }

  if (!n.arguments || !isLiteral(n.arguments[0])) {
    return null;
  }

  return {
    v1: getLiteralValue(n.arguments[0]),
    v2: isLiteral(n.arguments[1]) ? getLiteralValue(n.arguments[1]) : null,
  };
}

/**
 * Matches `require("lit"[, "lit"])`, plus two ESM idioms that resolve to the
 * same thing: `createRequire(import.meta.url)("lit")` (direct invocation) and
 * `r("lit")` where `r` was bound from `createRequire(…)`.
 */
function visitorRequire(n: babelTypes.Node, requireAliases?: Set<string>) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  let isRequireCall = false;

  if (babelTypes.isIdentifier(n.callee)) {
    isRequireCall = isRequireName(n.callee.name, requireAliases);
  } else if (isCreateRequireCall(n.callee)) {
    isRequireCall = true;
  }

  if (!isRequireCall) {
    return null;
  }

  if (!n.arguments || !isLiteral(n.arguments[0])) {
    return null;
  }

  return {
    v1: getLiteralValue(n.arguments[0]),
    v2: isLiteral(n.arguments[1]) ? getLiteralValue(n.arguments[1]) : null,
  };
}

/** Matches a static ESM `import … from "lit"` declaration. */
function visitorImport(n: babelTypes.Node) {
  if (!babelTypes.isImportDeclaration(n)) {
    return null;
  }

  return { v1: n.source.value, v3: reconstructSpecifiers(n.specifiers) };
}

/**
 * Matches ESM re-exports — `export * from "lit"`, `export * as ns from "lit"`,
 * `export { x } from "lit"`. The walker's CJS pass handles these via the
 * ESM→CJS transformer (`lib/esm-transformer.ts`), but in SEA mode that
 * transform is skipped, so without this matcher every barrel file silently
 * drops its re-exports.
 */
function visitorReExport(n: babelTypes.Node) {
  if (
    !babelTypes.isExportAllDeclaration(n) &&
    !babelTypes.isExportNamedDeclaration(n)
  ) {
    return null;
  }

  if (!n.source || typeof n.source.value !== 'string') {
    return null;
  }

  return { v1: n.source.value };
}

/**
 * Matches `new URL("./rel", import.meta.url)` — the canonical ESM idiom for
 * sibling assets (the equivalent of `path.join(__dirname, …)` in CJS). The
 * literal first arg is treated as a snapshot-relative asset.
 */
function visitorNewURL(n: babelTypes.Node) {
  if (!babelTypes.isNewExpression(n)) {
    return null;
  }

  if (!babelTypes.isIdentifier(n.callee) || n.callee.name !== 'URL') {
    return null;
  }

  if (!n.arguments || !isLiteral(n.arguments[0])) {
    return null;
  }

  const second = n.arguments[1];

  // Only match the import.meta.url base — other bases (absolute URLs,
  // arbitrary strings) don't resolve to a snapshot-relative path.
  if (
    !second ||
    !babelTypes.isMemberExpression(second) ||
    second.object.type !== 'MetaProperty' ||
    !babelTypes.isIdentifier(second.property) ||
    second.property.name !== 'url'
  ) {
    return null;
  }

  const value = getLiteralValue(n.arguments[0] as babelTypes.Literal);

  if (typeof value !== 'string') {
    return null;
  }

  return { v1: value };
}

/**
 * Matches `import.meta.resolve("lit")` — the modern ESM resolver API,
 * gradually replacing `require.resolve` in ESM code. The literal first arg is
 * resolved through the same `follow` path as `require.resolve`.
 */
function visitorImportMetaResolve(n: babelTypes.Node) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  if (!babelTypes.isMemberExpression(n.callee)) {
    return null;
  }

  if (
    n.callee.object.type !== 'MetaProperty' ||
    !babelTypes.isIdentifier(n.callee.property) ||
    n.callee.property.name !== 'resolve'
  ) {
    return null;
  }

  if (!n.arguments || !isLiteral(n.arguments[0])) {
    return null;
  }

  const value = getLiteralValue(n.arguments[0] as babelTypes.Literal);

  if (typeof value !== 'string') {
    return null;
  }

  return { v1: value };
}

/** Matches dynamic `import("lit")` so bundler-emitted chunk splits get walked like static imports. */
function visitorDynamicImport(n: babelTypes.Node) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  if (n.callee.type !== 'Import') {
    return null;
  }

  if (!n.arguments || !isLiteral(n.arguments[0])) {
    return null;
  }

  // Module specifiers are always strings — reject `import(0)` / `import(true)`
  // so a non-string value can't reach the walker's alias handling.
  const value = getLiteralValue(n.arguments[0] as babelTypes.Literal);

  if (typeof value !== 'string') {
    return null;
  }

  return { v1: value };
}

/**
 * Matches `path.join(__dirname, "a"[, "b", …])` and `path.resolve(__dirname,
 * "a"[, "b", …])` — treats the joined path as a snapshot-relative asset
 * reference. Multi-segment joins concatenate to a single posix-style alias so
 * the walker's `path.join(dirname, alias)` later normalizes correctly on every
 * platform. Bails on any non-literal segment to avoid synthesizing wrong
 * paths from `__dirname` + a runtime value.
 */
function visitorPathJoin(n: babelTypes.Node) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  if (!babelTypes.isMemberExpression(n.callee)) {
    return null;
  }

  const ci =
    n.callee.object &&
    n.callee.object.type === 'Identifier' &&
    n.callee.object.name === 'path' &&
    n.callee.property &&
    n.callee.property.type === 'Identifier' &&
    (n.callee.property.name === 'join' || n.callee.property.name === 'resolve');

  if (!ci) {
    return null;
  }

  const dn =
    n.arguments[0] &&
    n.arguments[0].type === 'Identifier' &&
    n.arguments[0].name === '__dirname';

  if (!dn) {
    return null;
  }

  if (n.arguments.length < 2) {
    return null;
  }

  const segments: string[] = [];

  for (let i = 1; i < n.arguments.length; i += 1) {
    const arg = n.arguments[i];

    if (!isLiteral(arg)) {
      return null;
    }

    const value = getLiteralValue(arg as babelTypes.Literal);

    if (typeof value !== 'string') {
      return null;
    }

    segments.push(value);
  }

  return { v1: path.posix.join(...segments) };
}

/**
 * Runs each literal-arg matcher in order and returns the first hit as a
 * `{alias, aliasType, mustExclude?, mayExclude?}` derivative for the walker to
 * bundle. When `test` is true returns a printable form (used by unit tests).
 * `requireAliases` is the per-file set of identifiers bound to
 * `createRequire(…)` (computed by `detect`); pass it through so the walker
 * picks up `r("./foo")` calls where `r` was assigned from `createRequire`.
 */
export function visitorSuccessful(
  node: babelTypes.Node,
  test = false,
  requireAliases?: Set<string>,
) {
  let was: Was | null = visitorRequireResolve(node, requireAliases);

  if (was) {
    if (test) {
      return forge('require.resolve({v1}{c2}{v2})', was);
    }

    if (!valid2(was.v2)) {
      return null;
    }

    return {
      alias: was.v1,
      aliasType: ALIAS_AS_RESOLVABLE,
      mustExclude: was.v2 === 'must-exclude',
      mayExclude: was.v2 === 'may-exclude',
    };
  }

  was = visitorRequire(node, requireAliases);

  if (was) {
    if (test) {
      return forge('require({v1}{c2}{v2})', was);
    }

    if (!valid2(was.v2)) {
      return null;
    }

    return {
      alias: was.v1,
      aliasType: ALIAS_AS_RESOLVABLE,
      mustExclude: was.v2 === 'must-exclude',
      mayExclude: was.v2 === 'may-exclude',
    };
  }

  was = visitorImport(node);

  if (was) {
    if (test) {
      return forge('import {v3}{c3}{v1}', was);
    }

    return { alias: was.v1, aliasType: ALIAS_AS_RESOLVABLE };
  }

  was = visitorReExport(node);

  if (was) {
    if (test) {
      return forge('export ... from {v1}', was);
    }

    return { alias: was.v1, aliasType: ALIAS_AS_RESOLVABLE };
  }

  was = visitorDynamicImport(node);

  if (was) {
    if (test) {
      return forge('import({v1})', was);
    }

    return { alias: was.v1, aliasType: ALIAS_AS_RESOLVABLE };
  }

  was = visitorImportMetaResolve(node);

  if (was) {
    if (test) {
      return forge('import.meta.resolve({v1})', was);
    }

    return { alias: was.v1, aliasType: ALIAS_AS_RESOLVABLE };
  }

  was = visitorNewURL(node);

  if (was) {
    if (test) {
      return forge('new URL({v1}, import.meta.url)', was);
    }

    return { alias: was.v1, aliasType: ALIAS_AS_RELATIVE, mayExclude: false };
  }

  was = visitorPathJoin(node);

  if (was) {
    if (test) {
      return forge('path.join(__dirname{c1}{v1})', was);
    }

    return { alias: was.v1, aliasType: ALIAS_AS_RELATIVE, mayExclude: false };
  }

  return null;
}

/** Matches `require.resolve(<non-literal>[, "lit"])` — feeds the "Cannot resolve" warning path. */
function nonLiteralRequireResolve(n: babelTypes.Node) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  if (!babelTypes.isMemberExpression(n.callee)) {
    return null;
  }

  const ci =
    n.callee.object.type === 'Identifier' &&
    n.callee.object.name === 'require' &&
    n.callee.property.type === 'Identifier' &&
    n.callee.property.name === 'resolve';

  if (!ci) {
    return null;
  }

  if (isLiteral(n.arguments[0])) {
    return null;
  }

  const m = n.arguments[1];

  if (!m) {
    return { v1: reconstruct(n.arguments[0]) };
  }

  if (!isLiteral(n.arguments[1])) {
    return null;
  }

  return {
    v1: reconstruct(n.arguments[0]),
    v2: getLiteralValue(n.arguments[1]),
  };
}

/** Matches `require(<non-literal>[, "lit"])` — feeds the "Cannot resolve" warning path. */
function nonLiteralRequire(n: babelTypes.Node) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  if (!babelTypes.isIdentifier(n.callee)) {
    return null;
  }

  if (n.callee.name !== 'require') {
    return null;
  }

  if (isLiteral(n.arguments[0])) {
    return null;
  }

  const m = n.arguments[1];

  if (!m) {
    return { v1: reconstruct(n.arguments[0]) };
  }

  if (!isLiteral(n.arguments[1])) {
    return null;
  }

  return {
    v1: reconstruct(n.arguments[0]),
    v2: getLiteralValue(n.arguments[1]),
  };
}

/** Entry visitor for dynamic requires whose target isn't known at build time — returns the alias to warn about. */
export function visitorNonLiteral(n: babelTypes.Node) {
  const was = nonLiteralRequireResolve(n) || nonLiteralRequire(n);

  if (was) {
    if (!valid2(was.v2)) {
      return null;
    }

    return {
      alias: was.v1,
      mustExclude: was.v2 === 'must-exclude',
      mayExclude: was.v2 === 'may-exclude',
    };
  }

  return null;
}

/** Loose `require(...)` match (no literal gate) — used only to surface malformed-require diagnostics. */
function isRequire(n: babelTypes.Node) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  if (!babelTypes.isIdentifier(n.callee)) {
    return null;
  }

  if (n.callee.name !== 'require') {
    return null;
  }

  const f = n.arguments && n.arguments[0];

  if (!f) {
    return null;
  }

  return { v1: reconstruct(n.arguments[0]) };
}

/** Loose `require.resolve(...)` match (no literal gate) — used only for malformed-require diagnostics. */
function isRequireResolve(n: babelTypes.Node) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  if (!babelTypes.isMemberExpression(n.callee)) {
    return null;
  }

  const ci =
    n.callee.object.type === 'Identifier' &&
    n.callee.object.name === 'require' &&
    n.callee.property.type === 'Identifier' &&
    n.callee.property.name === 'resolve';

  if (!ci) {
    return null;
  }

  const f = n.type === 'CallExpression' && n.arguments && n.arguments[0];

  if (!f) {
    return null;
  }

  return { v1: reconstruct(n.arguments[0]) };
}

/** Fires on require/require.resolve shapes the literal matchers rejected (wrong arg count, etc.). */
export function visitorMalformed(n: babelTypes.Node) {
  const was = isRequireResolve(n) || isRequire(n);

  if (was) {
    return { alias: was.v1 };
  }

  return null;
}

/**
 * Flags `path.resolve(...)` so the walker can warn that it resolves against
 * `process.cwd()` at runtime, not `__dirname`. Skips the `path.resolve(__dirname, …)`
 * shape — that case is matched by `visitorPathJoin` and bundled, so warning
 * here would be both spurious and contradictory (we'd warn about the same
 * call we just decided to include in the snapshot).
 */
export function visitorUseSCWD(n: babelTypes.Node) {
  if (!babelTypes.isCallExpression(n)) {
    return null;
  }

  if (!babelTypes.isMemberExpression(n.callee)) {
    return null;
  }

  const ci =
    n.callee.object.type === 'Identifier' &&
    n.callee.object.name === 'path' &&
    n.callee.property.type === 'Identifier' &&
    n.callee.property.name === 'resolve';

  if (!ci) {
    return null;
  }

  const firstArg = n.arguments[0];

  if (
    firstArg &&
    babelTypes.isIdentifier(firstArg) &&
    firstArg.name === '__dirname'
  ) {
    return null;
  }

  const was = { v1: n.arguments.map(reconstruct).join(', ') };

  if (was) {
    return { alias: was.v1 };
  }

  return null;
}

type VisitorFunction = (
  node: babelTypes.Node,
  trying?: boolean,
  requireAliases?: Set<string>,
) => boolean;

/**
 * Iterative DFS over the AST. `visitor` returns true to descend into children;
 * `trying` is propagated inside try/catch bodies so the walker can downgrade
 * downstream warnings to debug.
 */
function traverse(ast: babelTypes.File, visitor: VisitorFunction) {
  // modified esprima-walk to support
  // visitor return value and "trying" flag
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack: Array<[any, boolean]> = [[ast, false]];

  for (let i = 0; i < stack.length; i += 1) {
    const item = stack[i];
    const [node] = item;

    if (node) {
      const trying = item[1] || babelTypes.isTryStatement(node);

      if (visitor(node, trying)) {
        for (const key in node) {
          if (node[key as keyof babelTypes.File]) {
            const child = node[key as keyof babelTypes.File];

            if (child instanceof Array) {
              for (let j = 0; j < child.length; j += 1) {
                stack.push([child[j], trying]);
              }
            } else if (child && typeof child.type === 'string') {
              stack.push([child, trying]);
            }
          }
        }
      }
    }
  }
}

/**
 * `babel.parse` wrapper. `isEsm` selects `sourceType: 'module'` so `import.meta`
 * / top-level await parse cleanly. `decorators-legacy` is enabled so third-party
 * sources that ship raw `@decorator` syntax (fontkit, older MobX/Nest builds,
 * etc.) don't trip the parser and silently drop their dependency graph.
 */
export function parse(body: string, isEsm = false) {
  return babel.parse(body, {
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    sourceType: isEsm ? 'module' : 'script',
    plugins: ['decorators-legacy'],
  });
}

/**
 * Pre-scan pass: collects identifiers bound to `createRequire(…)` so the main
 * traversal can recognize `r("./foo")` (where `r` was assigned from
 * `createRequire`) as a require-equivalent. A single AST scan keeps this O(n);
 * the names set is then captured by the visitor closure.
 */
function collectRequireAliases(ast: babelTypes.File) {
  const names = new Set<string>();

  traverse(ast, (node) => {
    if (
      babelTypes.isVariableDeclarator(node) &&
      babelTypes.isIdentifier(node.id) &&
      isCreateRequireCall(node.init)
    ) {
      names.add(node.id.name);
    } else if (
      babelTypes.isAssignmentExpression(node) &&
      babelTypes.isIdentifier(node.left) &&
      isCreateRequireCall(node.right)
    ) {
      names.add(node.left.name);
    }

    return true;
  });

  return names;
}

/**
 * Parses `body` and walks the AST with `visitor`. Parse failures are logged
 * (not thrown) so one unparseable file doesn't abort the whole build — but the
 * file's dependencies are then skipped, which is why callers must pass the
 * correct `isEsm` flag. Before the main walk we collect identifiers bound to
 * `createRequire(…)` and forward the set to the visitor (3rd arg) so it can
 * treat aliased requires as first-class.
 */
export function detect(
  body: string,
  visitor: VisitorFunction,
  file?: string,
  isEsm = false,
) {
  let json;

  try {
    json = parse(body, isEsm);
  } catch (error) {
    const fileInfo = file ? ` in ${file}` : '';
    log.warn(`Babel parse has failed: ${(error as Error).message}${fileInfo}`);
  }

  if (!json) {
    return;
  }

  const requireAliases = collectRequireAliases(json);

  traverse(json, (node, trying) => visitor(node, trying, requireAliases));
}
