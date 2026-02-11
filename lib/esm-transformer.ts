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
 * Check if code contains import.meta usage
 *
 * @param code - The ESM source code to check
 * @returns true if import.meta is used, false otherwise
 */
function hasImportMeta(code: string): boolean {
  try {
    const ast = babel.parse(code, {
      sourceType: 'module',
      plugins: [],
    });

    if (!ast) {
      return false;
    }

    let found = false;

    // @ts-expect-error Type mismatch due to @babel/types version in @types/babel__traverse
    traverse(ast as t.File, {
      // Detect import.meta usage
      MetaProperty(path: NodePath<t.MetaProperty>) {
        if (
          path.node.meta.name === 'import' &&
          path.node.property.name === 'meta'
        ) {
          found = true;
          path.stop(); // Stop traversal once found
        }
      },
    });

    return found;
  } catch (error) {
    // If we can't parse, assume no import.meta
    return false;
  }
}

/**
 * Detect ESM features that cannot be safely transformed to CommonJS
 * These include:
 * - Top-level await (no CJS equivalent)
 *
 * Note: import.meta is now supported via polyfills and is no longer unsupported
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
    const ast = babel.parse(code, {
      sourceType: 'module',
      plugins: [],
    });

    if (!ast) {
      return null;
    }

    const unsupportedFeatures: UnsupportedFeature[] = [];

    // @ts-expect-error Type mismatch due to @babel/types version in @types/babel__traverse
    traverse(ast as t.File, {
      // Detect top-level await
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
          unsupportedFeatures.push({
            feature: 'top-level await',
            line: path.node.loc?.start.line ?? null,
            column: path.node.loc?.start.column ?? null,
          });
        }
      },

      // Detect for-await-of at top level
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
 * Replace esbuild's empty import_meta object with a proper implementation
 *
 * When esbuild transforms ESM to CJS, it converts `import.meta` to a `const import_meta = {}`.
 * This function replaces that empty object with a proper implementation of import.meta properties.
 *
 * Shims provided:
 * - import.meta.url: File URL of the current module
 * - import.meta.dirname: Directory path of the current module (Node.js 20.11+)
 * - import.meta.filename: File path of the current module (Node.js 20.11+)
 *
 * Based on approach from tsup and esbuild discussions
 * @see https://github.com/egoist/tsup/blob/main/assets/cjs_shims.js
 * @see https://github.com/evanw/esbuild/issues/3839
 *
 * @param code - The transformed CJS code from esbuild
 * @returns Code with import_meta properly implemented
 */
function replaceImportMetaObject(code: string): string {
  // esbuild generates: const import_meta = {};
  // We need to replace this with a proper implementation
  // Note: We use getters to ensure values are computed at runtime in the correct context
  const shimImplementation = `const import_meta = {
  get url() {
    return require('url').pathToFileURL(__filename).href;
  },
  get dirname() {
    return __dirname;
  },
  get filename() {
    return __filename;
  }
};`;

  // Replace esbuild's empty import_meta object with our implementation
  // Match: const import_meta = {};
  return code.replace(/const import_meta\s*=\s*\{\s*\};/, shimImplementation);
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

  // Check if code uses import.meta before transformation
  const usesImportMeta = hasImportMeta(code);

  try {
    const result = esbuild.transformSync(code, {
      loader: 'js',
      format: 'cjs',
      target: 'node18',
      sourcemap: false,
      minify: false,
      keepNames: true,
    });

    if (!result || !result.code) {
      log.warn(`esbuild transform returned no code for ${filename}`);
      return {
        code,
        isTransformed: false,
      };
    }

    // Inject import.meta shims after esbuild transformation if needed
    let finalCode = result.code;
    if (usesImportMeta) {
      finalCode = replaceImportMetaObject(result.code);
    }

    return {
      code: finalCode,
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
