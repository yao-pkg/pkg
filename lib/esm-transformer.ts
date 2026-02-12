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
 * Wrapper for top-level await support
 * Wraps code in an async IIFE to allow top-level await in CommonJS
 */
const ASYNC_IIFE_WRAPPER = {
  prefix: '(async () => {\n',
  suffix: '\n})()',
};

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
  } catch (_error) {
    // If we can't parse, assume no import.meta
    return false;
  }
}

/**
 * Detect ESM features that require special handling or cannot be transformed
 * These include:
 * - Top-level await (can be handled with async IIFE wrapper)
 *
 * Note: import.meta is now supported via polyfills and is no longer in the unsupported list
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

  // If top-level await is detected, we need to wrap in async IIFE
  // But we must handle imports and exports specially
  if (hasTopLevelAwait) {
    try {
      // Parse the code to check for exports and collect imports
      const ast = babel.parse(code, {
        sourceType: 'module',
        plugins: [],
      });

      let hasExports = false;
      const codeLines = code.split('\n');
      const importLineIndices = new Set<number>();

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
        ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
          // Track import statements by line number
          const { loc } = path.node;
          if (loc) {
            const { start, end } = loc;
            for (let i = start.line; i <= end.line; i += 1) {
              importLineIndices.add(i - 1); // Convert to 0-based index
            }
          }
        },
      });

      if (hasExports) {
        // If the file has exports, we can't wrap it in an IIFE
        // because exports need to be synchronous and at the top level.
        log.warn(
          `Module ${filename} has both top-level await and export statements. ` +
            `This combination cannot be safely transformed to CommonJS in pkg's ESM transformer. ` +
            `The original source code will be used as-is; depending on the package visibility and build configuration, ` +
            `bytecode compilation may fail and the module may need to be loaded from source or be skipped.`,
        );
        return {
          code,
          isTransformed: false,
        };
      }

      // If there are imports, extract them to keep outside the async IIFE
      if (importLineIndices.size > 0) {
        const imports: string[] = [];
        const rest: string[] = [];

        codeLines.forEach((line, index) => {
          if (importLineIndices.has(index)) {
            imports.push(line);
          } else {
            rest.push(line);
          }
        });

        // Reconstruct: imports at top, then async IIFE wrapping the rest
        codeToTransform = `${imports.join('\n')}\n${ASYNC_IIFE_WRAPPER.prefix}${rest.join('\n')}${ASYNC_IIFE_WRAPPER.suffix}`;

        log.debug(
          `Wrapping ${filename} in async IIFE with imports extracted to top level`,
        );
      } else {
        // No imports, wrap everything
        codeToTransform =
          ASYNC_IIFE_WRAPPER.prefix + code + ASYNC_IIFE_WRAPPER.suffix;

        log.debug(
          `Wrapping ${filename} in async IIFE to support top-level await`,
        );
      }
    } catch (parseError) {
      // If we can't parse, wrap everything and hope for the best
      codeToTransform =
        ASYNC_IIFE_WRAPPER.prefix + code + ASYNC_IIFE_WRAPPER.suffix;

      log.warn(
        `Could not parse ${filename} to detect exports/imports (${
          parseError instanceof Error ? parseError.message : String(parseError)
        }). ` +
          `Wrapping entire code in async IIFE - this may fail if the module has export or import statements.`,
      );
    }
  }

  // Check if code uses import.meta before transformation
  const usesImportMeta = hasImportMeta(code);

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
