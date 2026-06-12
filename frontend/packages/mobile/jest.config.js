'use strict';

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    // Standard node_modules: ignore everything except RN/Expo packages AND .pnpm itself
    'node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@shopify/.*))',
    // pnpm virtual store: inside .pnpm/<pkg>/node_modules/, ignore everything except RN/Expo
    'node_modules/\\.pnpm/.+/node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@shopify/.*))',
  ],
  testMatch: ['**/__tests__/**/*.test.(ts|tsx|js)'],
  setupFilesAfterEnv: ['./jest.setup.js'],
  moduleNameMapper: {
    // Match any relative depth (../../, ../../../, ...) so the real client never
    // loads in tests — its transform requires @babel/runtime helpers that don't
    // resolve from shared/, which is not a real pnpm package.
    '^(\\.\\./)+shared/api/client$': '<rootDir>/__mocks__/shared-api-client.js',
    '^@shared/utils/apiErrors$': '<rootDir>/__mocks__/shared-api-errors.js',
    '^../utils/notifications$': '<rootDir>/__mocks__/notifications.js',
    '^expo-location$': '<rootDir>/__mocks__/expo-location.js',
    '^expo-image-picker$': '<rootDir>/__mocks__/expo-image-picker.js',
    '^react-native-maps$': '<rootDir>/__mocks__/react-native-maps.js',
    '^@shared/(.*)$': '<rootDir>/../shared/$1',
    '^@/(.*)$': '<rootDir>/$1',
  },
};
