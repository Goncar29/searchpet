// The react-hooks plugin is resolved from eslint-config-expo, which is what
// loads it: the same copy, so the same rule list eslint applies.
const reactHooks = require(
  require.resolve('eslint-plugin-react-hooks', {
    paths: [require.resolve('eslint-config-expo')],
  }),
);
const CLASSIC_HOOK_RULES = ['react-hooks/rules-of-hooks', 'react-hooks/exhaustive-deps'];
const compilerRulesOff = Object.fromEntries(
  Object.keys(reactHooks.configs.recommended.rules)
    .filter((rule) => !CLASSIC_HOOK_RULES.includes(rule))
    .map((rule) => [rule, 'off']),
);

module.exports = {
  extends: ['expo', 'plugin:i18next/recommended'],
  plugins: ['i18next'],
  rules: {
    // `expo` pulls in react-hooks' "recommended" preset (via
    // eslint-config-expo/utils/react.js), which in v7 also enables the React
    // Compiler rules on top of the two classic ones. Web made the same call
    // for the same reason (see the header comment in
    // frontend/packages/web/eslint.config.js): those rules flag a different
    // class of problem — compiler-safety, not stale closures — and would
    // bury exhaustive-deps, the one that actually catches bugs here. Every
    // rule the preset enables EXCEPT the two classic ones is turned off, read
    // from the plugin itself so a compiler rule added in a future version is
    // off too. The two classic ones never enter that list; they are set below.
    ...compilerRulesOff,
    // The two classic rules — kept on, matching web.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // Catch hardcoded user-facing strings that should go through i18n.
    // mode: 'jsx-text-only' — only JSX text nodes, not attributes or JS strings.
    'i18next/no-literal-string': [
      'warn',
      {
        mode: 'jsx-text-only',

        // Attributes that carry non-translatable values.
        'jsx-attributes': {
          exclude: [
            'testID',
            'accessibilityLabel',
            'accessibilityHint',
            'accessibilityRole',
            'importantForAccessibility',
            'key',
            'style',
            'source',
            'name',
            'type',
            'mode',
            'size',
            'color',
            'behavior',
            'keyboardType',
            'autoCapitalize',
            'autoComplete',
            'textContentType',
            'returnKeyType',
            'contentFit',
            'resizeMode',
            'placeholder',
          ],
        },

        // Word patterns to exclude. These are regex strings matched against
        // the raw string value. Emoji/symbol-only strings and unit
        // abbreviations are legitimate non-translated content.
        words: {
          exclude: [
            // Route strings (URL paths)
            '^/.*',
            // Strings that contain no letter characters at all:
            // emoji, symbols, punctuation, whitespace, digits.
            '^[^a-zA-Z\\u00C0-\\u024F]*$',
            // Unit abbreviations invariant across es/en/pt
            '^\\s*km\\s*$',
            '^\\s*pts\\s*$',
          ],
        },
      },
    ],
  },
  overrides: [
    // Jest setup and mock files run under Node, in the jest global — the
    // base config has neither env, so `jest`, `setTimeout`, `clearTimeout`
    // etc. are all `no-undef`.
    {
      files: ['__tests__/**', '__mocks__/**', 'jest.setup.js', '*.test.*'],
      env: { jest: true, node: true },
      rules: {
        // jest.mock() factories are hoisted above imports, so requiring
        // React/RN inside the factory (instead of importing them at the top
        // and referencing an out-of-scope variable) is the only way to
        // build a mock component — see __tests__/index.test.tsx and
        // __tests__/map.test.tsx.
        '@typescript-eslint/no-require-imports': 'off',
        // Test placeholder copy (e.g. '[esqueleto]', '[lista: N]') is never
        // shown to a real user — it exists only to make jest output legible.
        'i18next/no-literal-string': 'off',
        // Anonymous mock components assigned to a const (MockMapView, the
        // headerRight-style inline mocks) trip display-name; naming them
        // adds nothing a test reads.
        'react/display-name': 'off',
        // jest.mock() calls before an ES `import` are the documented
        // hoisting pattern (mocks must be registered before the module
        // under test is imported) — see __tests__/map.test.tsx.
        'import/first': 'off',
      },
    },
  ],
  ignorePatterns: ['node_modules/', 'i18n/locales/', '.expo/', 'dist/'],
};
