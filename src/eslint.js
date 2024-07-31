/* eslint perfectionist/sort-objects: "error" */
import { antfu } from '@antfu/eslint-config'

/** @type {typeof antfu} */
export default (config = {}, ...eslintConfig) => antfu(
  {
    ignores: [],
    jsx: false,
    typescript: false,
    ...config,
    formatters: {
      markdown: true,
      ...(typeof config.formatters === 'object' ? config.formatters : {}),
    },
    rules: {
      'antfu/if-newline': 0,
      'antfu/top-level-function': 0,
      'curly': ['error', 'multi-line'],
      'import/extensions': ['error', 'ignorePackages'],
      'import/order': 0,
      'jsdoc/check-alignment': 'warn',
      'jsdoc/check-line-alignment': 'warn',
      'jsdoc/require-returns-check': 0,
      'jsdoc/require-returns-description': 0,
      'no-undef': 'error',
      'perfectionist/sort-exports': 'error',
      'perfectionist/sort-imports': [
        'error',
        {
          groups: [
            'type',
            'internal-type',
            'builtin',
            'external',
            'internal',
            ['parent-type', 'sibling-type', 'index-type'],
            ['parent', 'sibling', 'index'],
            'object',
            'unknown',
          ],
          order: 'asc',
          type: 'natural',
        },
      ],
      'perfectionist/sort-named-exports': 'error',
      'perfectionist/sort-named-imports': 'error',
      'sort-imports': 0,
      'style/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      'style/quote-props': ['error', 'consistent-as-needed'],
      'test/no-only-tests': 'error',
      'unicorn/no-useless-spread': 'error',
      'unused-imports/no-unused-vars': ['error', { caughtErrors: 'none' }],
      'yaml/quotes': ['error', {
        avoidEscape: true,
        prefer: 'double',
      }],
      ...(config.rules || {}),
    },
  },
  {
    ignores: [
      'node_modules/',
      'public/',
      'docs/',
      'coverage/',
      'dist/',
      'bruno/',
      ...(config.ignores || []),
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        __dirname: 'off',
        __filename: 'off',
      },
    },
  },
  ...eslintConfig,
)
