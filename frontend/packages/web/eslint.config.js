// ESLint for the web app (G6 of the 2026-09-23 audit).
//
// The point is react-hooks/exhaustive-deps: a missing dependency in an effect
// or callback is a bug neither tsc nor the tests see. From react-hooks only the
// two classic rules are on; the v7 "recommended" preset also brings the React
// Compiler rules, which flag a different class of problem and would bury these.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      // Generated from src/firebase-messaging-sw.template.js at build time.
      'public/firebase-messaging-sw.js',
    ],
  },
  // Only TS/TSX, on purpose. The .js sources run elsewhere and would need
  // their own globals: public/sw.js is a service worker, api/share.js a Vercel
  // Node function, and the Firebase service-worker template another worker.
  // Linting them is a separate step, not an oversight.
  {
    files: ['**/*.{ts,tsx}'],
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
);
