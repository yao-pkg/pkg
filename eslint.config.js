const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const airbnbBase = require('eslint-config-airbnb-base');
const importPlugin = require('eslint-plugin-import');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  // Ignore patterns (replaces .eslintignore)
  {
    ignores: [
      'lib-es5/**',
      'node_modules/**',
      'dist/**',
      'test/test-51-esm-import-meta/esm-module/test-import-meta-basic.js',
      'lib/log.js', // ESM re-export file
      'test/test-50-extensions/test-y-esnext.js', // ESM test file
    ],
  },

  // Base config for JS files
  {
    files: ['**/*.js'],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...require('globals').node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...airbnbBase.rules,
      ...prettierConfig.rules,
      'no-bitwise': 'off',
      'no-continue': 'off',
      'no-await-in-loop': 'off',
      'no-constant-condition': 'off',
      'no-param-reassign': 'off',
      'consistent-return': 'off',
      'no-restricted-syntax': 'off',
      'import/prefer-default-export': 'off',
      camelcase: 'off',
    },
  },

  // TypeScript files
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...require('globals').node,
        NodeJS: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...airbnbBase.rules,
      ...prettierConfig.rules,
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'consistent-return': 'off',
      'import/prefer-default-export': 'off',
      'no-await-in-loop': 'off',
      'no-bitwise': 'off',
      'no-constant-condition': 'off',
      'no-continue': 'off',
      'no-param-reassign': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // Prelude directory overrides
  {
    files: ['prelude/**/*'],
    rules: {
      strict: 'off',
    },
  },

  // Test directory overrides
  {
    files: ['test/**/*'],
    rules: {
      'array-callback-return': 'off',
      'func-names': 'off',
      'global-require': 'off',
      'guard-for-in': 'off',
      'import/extensions': 'off',
      'import/no-dynamic-require': 'off',
      'import/no-extraneous-dependencies': 'off',
      'import/newline-after-import': 'off',
      'import/no-unresolved': 'off',
      'import/no-useless-path-segments': 'off',
      'import/order': 'off',
      'no-console': 'off',
      'no-lonely-if': 'off',
      'no-multi-assign': 'off',
      'no-undef': 'off',
      'no-else-return': 'off',
      'no-use-before-define': 'off',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'object-shorthand': 'off',
      'one-var': 'off',
      'prefer-arrow-callback': 'off',
      'prefer-destructuring': 'off',
      'prefer-object-spread': 'off',
      'prefer-template': 'off',
      strict: ['error', 'global'],
    },
  },
];
