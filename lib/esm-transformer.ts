import * as babel from '@babel/core';
import traverse, { NodePath } from '@babel/traverse';
import { log } from './log';
import { unlikelyJavascript } from './common';

export interface TransformResult {
  code: string;
  isTransformed: boolean;
}

interface UnsupportedFeature {
  feature: string;
  line: number | null;
  column: number | null;
}

/**
 * Detect ESM features that cannot be safely transformed to CommonJS
 * These include:
 * - Top-level await (no CJS equivalent)
 * - import.meta (no CJS equivalent)
 *
 * @param code - The ESM source code to check
 * @param filename - The filename for error reporting
 * @returns Array of unsupported features found, or null if parse fails
 */
function detectUnsupportedESMFeatures(
  code: string,
  filename: string,
): UnsupportedFeature[] | null {
  try {
    const ast = babel.parseSync(code, {
      filename,
      sourceType: 'module',
      plugins: [],
    });

    if (!ast) {
      return null;
    }

    const unsupportedFeatures: UnsupportedFeature[] = [];

    traverse(ast, {
      // Detect import.meta usage
      MetaProperty(path) {
        if (
          path.node.meta.name === 'import' &&
          path.node.property.name === 'meta'
        ) {
          unsupportedFeatures.push({
            feature: 'import.meta',
            line: path.node.loc?.start.line ?? null,
            column: path.node.loc?.start.column ?? null,
          });
        }
      },

      // Detect top-level await
      AwaitExpression(path) {
        // Check if await is at top level (not inside a function)
        let parent: NodePath | null = path.parentPath;
        let isTopLevel = true;

        while (parent) {
          if (
            parent.isFunctionDeclaration() ||
            parent.isFunctionExpression() ||
            parent.isArrowFunctionExpression() ||
            parent.isObjectMethod() ||
            parent.isClassMethod()
          ) {
            isTopLevel = false;
            break;
          }
          parent = parent.parentPath;
        }

        if (isTopLevel) {
          unsupportedFeatures.push({
            feature: 'top-level await',
            line: path.node.loc?.start.line ?? null,
            column: path.node.loc?.start.column ?? null,
          });
        }
      },

      // Detect for-await-of at top level
      ForOfStatement(path) {
        if (path.node.await) {
          let parent: NodePath | null = path.parentPath;
          let isTopLevel = true;

          while (parent) {
            if (
              parent.isFunctionDeclaration() ||
              parent.isFunctionExpression() ||
              parent.isArrowFunctionExpression() ||
              parent.isObjectMethod() ||
              parent.isClassMethod()
            ) {
              isTopLevel = false;
              break;
            }
            parent = parent.parentPath;
          }

          if (isTopLevel) {
            unsupportedFeatures.push({
              feature: 'top-level for-await-of',
              line: path.node.loc?.start.line ?? null,
              column: path.node.loc?.start.column ?? null,
            });
          }
        }
      },
    });

    return unsupportedFeatures;
  } catch (error) {
    // If we can't parse, return null to let the transform attempt proceed
    log.debug(
      `Could not parse ${filename} to detect unsupported ESM features: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Transform ESM code to CommonJS using Babel
 * This allows ESM modules to be compiled to bytecode via vm.Script
 *
 * @param code - The ESM source code to transform
 * @param filename - The filename for error reporting
 * @returns Object with transformed code and success flag
 */
export function transformESMtoCJS(
  code: string,
  filename: string,
): TransformResult {
  // Skip files that are unlikely to be JavaScript (e.g., .d.ts, .json, .css)
  // to avoid Babel parse errors
  if (unlikelyJavascript(filename)) {
    return {
      code,
      isTransformed: false,
    };
  }

  // First, check for unsupported ESM features that can't be safely transformed
  const unsupportedFeatures = detectUnsupportedESMFeatures(code, filename);

  if (unsupportedFeatures && unsupportedFeatures.length > 0) {
    const featureList = unsupportedFeatures
      .map((f) => {
        const location = f.line !== null ? ` at line ${f.line}` : '';
        return `  - ${f.feature}${location}`;
      })
      .join('\n');

    const errorMessage = [
      `Cannot transform ESM module ${filename} to CommonJS:`,
      `The following ESM features have no CommonJS equivalent:`,
      featureList,
      '',
      'These features are not supported when compiling to bytecode.',
      'Consider one of the following:',
      '  1. Refactor to avoid these features',
      '  2. Use --no-bytecode flag to keep the module as source code',
      '  3. Mark the package as public to distribute with sources',
    ].join('\n');

    log.warn(errorMessage);

    // Return untransformed code rather than throwing
    // This allows the file to be included as content instead of bytecode
    return {
      code,
      isTransformed: false,
    };
  }

  try {
    const result = babel.transformSync(code, {
      filename,
      plugins: [
        [
          '@babel/plugin-transform-modules-commonjs',
          {
            strictMode: true,
            allowTopLevelThis: true,
          },
        ],
      ],
      sourceMaps: false,
      compact: false,
      // Don't modify other syntax, only transform import/export
      presets: [],
      // Prevent Babel from loading user config files
      babelrc: false,
      configFile: false,
      sourceType: 'module',
    });

    if (!result || !result.code) {
      log.warn(`Babel transform returned no code for ${filename}`);
      return {
        code,
        isTransformed: false,
      };
    }

    return {
      code: result.code,
      isTransformed: true,
    };
  } catch (error) {
    log.warn(
      `Failed to transform ESM to CJS for ${filename}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {
      code,
      isTransformed: false,
    };
  }
}
