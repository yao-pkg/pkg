import * as babel from '@babel/core';
import { log } from './log';

export interface TransformResult {
  code: string;
  isTransformed: boolean;
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
