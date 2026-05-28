'use strict';

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/[^/]+/node_modules/)?(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@shopify/.*)',
  ],
  testMatch: ['**/__tests__/**/*.test.(ts|tsx|js)'],
  setupFilesAfterEnv: ['./jest.setup.js'],
  moduleNameMapper: {
    '^../../shared/api/client$': '<rootDir>/__mocks__/shared-api-client.js',
    '^../utils/notifications$': '<rootDir>/__mocks__/notifications.js',
    '^expo-location$': '<rootDir>/__mocks__/expo-location.js',
    '^expo-image-picker$': '<rootDir>/__mocks__/expo-image-picker.js',
    '^react-native-maps$': '<rootDir>/__mocks__/react-native-maps.js',
    '^@shared/(.*)$': '<rootDir>/../shared/$1',
    '^@/(.*)$': '<rootDir>/$1',
  },
};
