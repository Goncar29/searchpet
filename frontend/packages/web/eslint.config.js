// ESLint for the web app and for shared/ (G6 and G6b of the 2026-09-23 audit).
//
// The point is react-hooks/exhaustive-deps: a missing dependency in an effect
// or callback is a bug neither tsc nor the tests see. From react-hooks only the
// two classic rules are on; the v7 "recommended" preset also brings the React
// Compiler rules, which flag a different class of problem and would bury these.
//
// RUN FROM frontend/packages/, NOT FROM web/ (the `lint` script does the `cd`).
// ESLint only lints files under its base path, which is the directory it runs
// from when --config is given. shared/ sits next to web/, not inside it, and it
// is not a package with its own node_modules (CLAUDE.md rule #15), so it cannot
// hold a config of its own. Running from the parent puts web/ and shared/ both
// under the base path; this file's own imports still resolve from web/. Every
// path below is therefore relative to frontend/packages/.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/coverage/',
      'web/playwright-report/',
      'web/test-results/',
      // Generated from src/firebase-messaging-sw.template.js at build time.
      'web/public/firebase-messaging-sw.js',
    ],
  },

  // The React app and the code it shares with mobile (hooks, API client,
  // utils). shared/ is where the React Query hooks live.
  {
    files: ['web/**/*.{ts,tsx}', 'shared/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // A leading underscore marks a parameter kept only for the signature
      // (mocks that must match the real function).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // shared/ is compiled by TWO TypeScripts, web's and mobile's. A line that
  // imports a package only one platform installs (TensorFlow) errors in one
  // and not the other, so @ts-expect-error would break the side where it does
  // not error. @ts-ignore is the right tool there, but it must say why.
  {
    files: ['shared/**/*.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': 'allow-with-description' },
      ],
    },
  },

  // Service workers: classic scripts with the worker globals (self, caches,
  // clients, importScripts). The Firebase one also gets `firebase`, which it
  // loads with importScripts.
  {
    files: ['web/public/sw.js', 'web/src/firebase-messaging-sw.template.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'script',
      globals: globals.serviceworker,
    },
  },
  {
    files: ['web/src/firebase-messaging-sw.template.js'],
    languageOptions: {
      globals: { firebase: 'readonly' },
    },
  },

  // Node: the Vercel function behind /share, the build scripts, this config.
  {
    files: ['web/api/**/*.js', 'web/scripts/**/*.mjs', 'web/eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Browser-side JS stubs that stand in for mobile-only packages.
  {
    files: ['web/src/stubs/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
);
