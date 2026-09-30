import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', '.shots'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // src/core is pure: no React, DOM, storage, network, clock or randomness.
  {
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-*', 'react/*'], message: 'src/core must not import React.' },
            { group: ['dexie', 'dexie-*'], message: 'src/core must not import storage.' },
            {
              group: ['**/data/**', '**/app/**'],
              message: 'src/core must not import data or app layers.',
            },
            { group: ['@dagrejs/*'], message: 'Layout belongs in the app layer.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'fetch',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'XMLHttpRequest',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Inject a Clock.' },
        { object: 'Math', property: 'random', message: 'Inject an IdGen.' },
        { object: 'crypto', property: 'randomUUID', message: 'Inject an IdGen.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'new Date() reads the clock. Inject a Clock.',
        },
      ],
    },
  },
);
