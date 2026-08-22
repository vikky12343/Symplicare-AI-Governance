import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint configuration, doubling as the static analysis step in the release gate.
 *
 * The rules below are the ones that catch defects rather than opinions about
 * formatting. Anything stylistic is left alone deliberately — a lint run that
 * cries wolf about spacing is a lint run people learn to skip.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.mongo-data/**',
      '**/.storage/**',
      '**/coverage/**',
      /* Throwaway verification scripts kept at the root, outside any tsconfig. */
      '.*.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          /* Files outside any tsconfig: the lint and build configs, and the
             Playwright end-to-end suite, which the app's tsconfig excludes so
             that its types do not leak into the shipped build. */
          allowDefaultProject: [
            'eslint.config.mjs',
            '*.config.ts',
            'apps/web/playwright.config.ts',
            'apps/web/e2e/*.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { security },
    rules: {
      /* --- correctness --------------------------------------------------- */
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'warn',
      'no-return-await': 'off',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      /* --- unused code ---------------------------------------------------- */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      /* --- the type escapes worth arguing about --------------------------- */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',

      /* --- security ------------------------------------------------------- */
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-child-process': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /* The web client: React rules, and the browser globals it actually uses. */
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        File: 'readonly',
        Event: 'readonly',
        PopStateEvent: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLFormElement: 'readonly',
        RequestInit: 'readonly',
        React: 'readonly',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /* A React component that throws inside render blanks its subtree, so the
         boundary is the safety net rather than the fix. */
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  /* Node services: the console is the log transport of last resort. */
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
  },

  /* Tests assert against loosely typed response bodies by design. */
  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  /* Command-line scripts are plain JavaScript with no tsconfig behind them, so
     they get the syntactic rules without the type-aware ones. They run at the
     terminal and report to it, so console output is the point. */
  {
    files: ['scripts/**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
    rules: {
      'no-console': 'off',
      'security/detect-child-process': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
);
