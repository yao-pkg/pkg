import * as babel from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import * as esbuild from 'esbuild';
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
 * Detect ESM features that require special handling or cannot be transformed
 * These include:
 * - Top-level await (can be handled with async IIFE wrapper)
 * - import.meta (no CJS equivalent - truly unsupported)
 *
 * @param code - The ESM source code to check
 * @param filename - The filename for error reporting
 * @returns Object with arrays of features requiring special handling
 */
function detectESMFeatures(
  code: string,
  filename: string,
): {
  topLevelAwait: UnsupportedFeature[];
  unsupportedFeatures: UnsupportedFeature[];
} | null {
  try {
    const ast = babel.parse(code, {
      sourceType: 'module',
      plugins: [],
    });

    if (!ast) {
      return null;
    }

    const topLevelAwait: UnsupportedFeature[] = [];
    const unsupportedFeatures: UnsupportedFeature[] = [];

    // @ts-expect-error Type mismatch due to @babel/types version in @types/babel__traverse
    traverse(ast as t.File, {
      // Detect import.meta usage - this is truly unsupported in CJS
      MetaProperty(path: NodePath<t.MetaProperty>) {
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

      // Detect top-level await - can be handled with async IIFE wrapper
      AwaitExpression(path: NodePath<t.AwaitExpression>) {
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
          topLevelAwait.push({
            feature: 'top-level await',
            line: path.node.loc?.start.line ?? null,
            column: path.node.loc?.start.column ?? null,
          });
        }
      },

      // Detect for-await-of at top level - can be handled with async IIFE wrapper
      ForOfStatement(path: NodePath<t.ForOfStatement>) {
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
            topLevelAwait.push({
              feature: 'top-level for-await-of',
              line: path.node.loc?.start.line ?? null,
              column: path.node.loc?.start.column ?? null,
            });
          }
        }
      },
    });

    return { topLevelAwait, unsupportedFeatures };
  } catch (error) {
    // If we can't parse, return null to let the transform attempt proceed
    log.debug(
      `Could not parse ${filename} to detect ESM features: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Transform ESM code to CommonJS using esbuild
 * This allows ESM modules to be compiled to bytecode via vm.Script
 * Uses Babel parser for detecting unsupported ESM features, then esbuild for fast transformation
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

  // First, check for ESM features that need special handling
  const esmFeatures = detectESMFeatures(code, filename);

  // Handle truly unsupported features (import.meta)
  if (
    esmFeatures &&
    esmFeatures.unsupportedFeatures &&
    esmFeatures.unsupportedFeatures.length > 0
  ) {
    const featureList = esmFeatures.unsupportedFeatures
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

  // Check if we need to wrap in async IIFE for top-level await
  const hasTopLevelAwait =
    esmFeatures &&
    esmFeatures.topLevelAwait &&
    esmFeatures.topLevelAwait.length > 0;

  let codeToTransform = code;

  // If top-level await is detected, wrap in async IIFE BEFORE transformation
  // This is necessary because esbuild cannot transform top-level await to CJS
  // However, we need to handle export statements specially since they can't be inside a function
  if (hasTopLevelAwait) {
    try {
      // Parse the code to separate exports from other statements
      const ast = babel.parse(code, {
        sourceType: 'module',
        plugins: [],
      });

      let hasExports = false;

      // Check if there are any export statements
      // @ts-expect-error Type mismatch due to @babel/types version
      traverse(ast as t.File, {
        ExportNamedDeclaration() {
          hasExports = true;
        },
        ExportDefaultDeclaration() {
          hasExports = true;
        },
        ExportAllDeclaration() {
          hasExports = true;
        },
      });

      if (hasExports) {
        // If the file has exports, we can't easily wrap it in an IIFE
        // because exports need to be synchronous and at the top level.
        // In this case, log a warning and don't transform
        log.warn(
          `Module ${filename} has both top-level await and export statements. ` +
            `This combination requires the module to be loaded as source code (not bytecode). ` +
            `The file will be included as content instead of bytecode.`,
        );
        return {
          code,
          isTransformed: false,
        };
      }

      // No exports, safe to wrap in async IIFE
      codeToTransform = `(async () => {\n${code}\n})()`;

      log.debug(
        `Wrapping ${filename} in async IIFE to support top-level await`,
      );
    } catch (parseError) {
      // If we can't parse to check for exports, try wrapping anyway
      codeToTransform = `(async () => {\n${code}\n})()`;

      log.debug(
        `Wrapping ${filename} in async IIFE to support top-level await (parse check failed)`,
      );
    }
  }

  try {
    // Build esbuild options
    const esbuildOptions: esbuild.TransformOptions = {
      loader: 'js',
      format: 'cjs',
      target: 'node18',
      sourcemap: false,
      minify: false,
      keepNames: true,
    };

    const result = esbuild.transformSync(codeToTransform, esbuildOptions);

    if (!result || !result.code) {
      log.warn(`esbuild transform returned no code for ${filename}`);
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
