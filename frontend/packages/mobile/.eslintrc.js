module.exports = {
  extends: ['expo', 'plugin:i18next/recommended'],
  plugins: ['i18next'],
  rules: {
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
  ignorePatterns: ['node_modules/', 'i18n/locales/', '.expo/', 'dist/'],
};
