import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { boundaries } from './tooling/eslint/boundaries.js';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/dev-dist/',
    '**/coverage/',
    'supabase/.temp/',
    'packages/data-supabase/src/database.types.ts',
    '.claude/worktrees/',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreVoidOperator: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // noUncheckedIndexedAccess already forces every unchecked index to be acknowledged.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Model collections are id-keyed records; deleting by id is how Immer records a removal.
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          // The shadcn CLI resolves the utils alias to an unrelated npm package named `cn`.
          paths: [{ name: 'cn', message: 'Import cn from @/ui/utils.' }],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  ...boundaries,
  prettier,
);
