import * as acorn from 'acorn';
import { log } from './log';

import { ALIAS_AS_RELATIVE, ALIAS_AS_RESOLVABLE } from './common';

// Minimal ESTree node types used by the detector
interface AcornNode {
  type: string;
  start: number;
  end: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function isLiteral(node: AcornNode): boolean {
  if (node == null) {
    return false;
  }

  if (node.type === 'Literal') {
    // Exclude null, regex
    return node.value !== null && !(node.value instanceof RegExp);
  }

  if (node.type === 'TemplateLiteral') {
    return node.expressions.length === 0;
  }

  return false;
}

function getLiteralValue(node: AcornNode) {
  if (node.type === 'TemplateLiteral') {
    return node.quasis[0].value.raw;
  }

  return node.value;
}

function reconstructSpecifiers(specs: AcornNode[]) {
  if (!specs || !specs.length) {
    return '';
  }

  const defaults = [];

  for (const spec of specs) {
    if (spec.type === 'ImportDefaultSpecifier') {
      defaults.push(spec.local.name);
    }
  }

  const nonDefaults = [];

  for (const spec of specs) {
    if (spec.type === 'ImportSpecifier') {
      const importedName = spec.imported.name;

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

function reconstruct(node: AcornNode, source: string) {
  let v = source.slice(node.start, node.end).replace(/\n/g, '');
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

function forge(pattern: string, was: Was) {
  return pattern
    .replace('{c1}', ', ')
    .replace('{v1}', `"${was.v1}"`)
    .replace('{c2}', was.v2 ? ', ' : '')
    .replace('{v2}', was.v2 ? `"${was.v2}"` : '')
    .replace('{c3}', was.v3 ? ' from ' : '')
    .replace('{v3}', was.v3 ? was.v3 : '');
}

function valid2(v2?: Was['v2']) {
  return (
    v2 === undefined ||
    v2 === null ||
    v2 === 'must-exclude' ||
    v2 === 'may-exclude'
  );
}

function visitorRequireResolve(n: AcornNode) {
  if (n.type !== 'CallExpression') {
    return null;
  }

  if (n.callee.type !== 'MemberExpression') {
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

  if (!n.arguments || !isLiteral(n.arguments[0])) {
    return null;
  }

  return {
    v1: getLiteralValue(n.arguments[0]),
    v2: isLiteral(n.arguments[1]) ? getLiteralValue(n.arguments[1]) : null,
  };
}

function visitorRequire(n: AcornNode) {
  if (n.type !== 'CallExpression') {
    return null;
  }

  if (n.callee.type !== 'Identifier') {
    return null;
  }

  if (n.callee.name !== 'require') {
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

function visitorImport(n: AcornNode) {
  if (n.type !== 'ImportDeclaration') {
    return null;
  }

  return { v1: n.source.value, v3: reconstructSpecifiers(n.specifiers) };
}

function visitorPathJoin(n: AcornNode) {
  if (n.type !== 'CallExpression') {
    return null;
  }

  if (n.callee.type !== 'MemberExpression') {
    return null;
  }

  const ci =
    n.callee.object &&
    n.callee.object.type === 'Identifier' &&
    n.callee.object.name === 'path' &&
    n.callee.property &&
    n.callee.property.type === 'Identifier' &&
    n.callee.property.name === 'join';

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

  const f =
    n.arguments && isLiteral(n.arguments[1]) && n.arguments.length === 2; // TODO concat them

  if (!f) {
    return null;
  }

  return { v1: getLiteralValue(n.arguments[1]) };
}

export function visitorSuccessful(node: AcornNode, test = false) {
  let was: Was | null = visitorRequireResolve(node);

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

  was = visitorRequire(node);

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

  was = visitorPathJoin(node);

  if (was) {
    if (test) {
      return forge('path.join(__dirname{c1}{v1})', was);
    }

    return { alias: was.v1, aliasType: ALIAS_AS_RELATIVE, mayExclude: false };
  }

  return null;
}

function nonLiteralRequireResolve(n: AcornNode, source: string) {
  if (n.type !== 'CallExpression') {
    return null;
  }

  if (n.callee.type !== 'MemberExpression') {
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
    return { v1: reconstruct(n.arguments[0], source) };
  }

  if (!isLiteral(n.arguments[1])) {
    return null;
  }

  return {
    v1: reconstruct(n.arguments[0], source),
    v2: getLiteralValue(n.arguments[1]),
  };
}

function nonLiteralRequire(n: AcornNode, source: string) {
  if (n.type !== 'CallExpression') {
    return null;
  }

  if (n.callee.type !== 'Identifier') {
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
    return { v1: reconstruct(n.arguments[0], source) };
  }

  if (!isLiteral(n.arguments[1])) {
    return null;
  }

  return {
    v1: reconstruct(n.arguments[0], source),
    v2: getLiteralValue(n.arguments[1]),
  };
}

export function visitorNonLiteral(n: AcornNode, source: string) {
  const was =
    nonLiteralRequireResolve(n, source) || nonLiteralRequire(n, source);

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

function isRequire(n: AcornNode, source: string) {
  if (n.type !== 'CallExpression') {
    return null;
  }

  if (n.callee.type !== 'Identifier') {
    return null;
  }

  if (n.callee.name !== 'require') {
    return null;
  }

  const f = n.arguments && n.arguments[0];

  if (!f) {
    return null;
  }

  return { v1: reconstruct(n.arguments[0], source) };
}

function isRequireResolve(n: AcornNode, source: string) {
  if (n.type !== 'CallExpression') {
    return null;
  }

  if (n.callee.type !== 'MemberExpression') {
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

  return { v1: reconstruct(n.arguments[0], source) };
}

export function visitorMalformed(n: AcornNode, source: string) {
  const was = isRequireResolve(n, source) || isRequire(n, source);

  if (was) {
    return { alias: was.v1 };
  }

  return null;
}

export function visitorUseSCWD(n: AcornNode, source: string) {
  if (n.type !== 'CallExpression') {
    return null;
  }

  if (n.callee.type !== 'MemberExpression') {
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

  const was = {
    v1: n.arguments.map((a: AcornNode) => reconstruct(a, source)).join(', '),
  };

  if (was) {
    return { alias: was.v1 };
  }

  return null;
}

type VisitorFunction = (node: AcornNode, trying?: boolean) => boolean;

function traverse(ast: AcornNode, visitor: VisitorFunction) {
  // modified esprima-walk to support
  // visitor return value and "trying" flag
  const stack: Array<[AcornNode, boolean]> = [[ast, false]];

  for (let i = 0; i < stack.length; i += 1) {
    const item = stack[i];
    const [node] = item;

    if (node) {
      const trying = item[1] || node.type === 'TryStatement';

      if (visitor(node, trying)) {
        for (const key in node) {
          if (node[key]) {
            const child = node[key];

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

export function parse(body: string) {
  // Try module mode first (handles import/export), fall back to script mode
  // for legacy code that uses strict-mode-incompatible syntax (e.g. `with`
  // statements, octal escapes). This matches Babel's permissive behavior.
  try {
    return acorn.parse(body, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowHashBang: true,
    }) as unknown as AcornNode;
  } catch (_) {
    return acorn.parse(body, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowHashBang: true,
    }) as unknown as AcornNode;
  }
}

export function detect(body: string, visitor: VisitorFunction, file?: string) {
  let ast: AcornNode | undefined;

  try {
    ast = parse(body);
  } catch (error) {
    const fileInfo = file ? ` in ${file}` : '';
    log.warn(`Acorn parse has failed: ${(error as Error).message}${fileInfo}`);
  }

  if (!ast) {
    return;
  }

  traverse(ast, visitor);
}
