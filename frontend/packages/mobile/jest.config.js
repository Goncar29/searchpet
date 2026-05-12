'use strict';

// Los tests del store son TypeScript puro — no necesitan jest-expo ni React Native.
// Los tests de componentes RN están pendientes hasta alinear versiones:
//   expo@49 + react-native@0.85 + jest-expo@55 son incompatibles entre sí.

module.exports = {
  displayName: 'mobile-store',
  testMatch: ['**/__tests__/store.test.ts'],
  transform: {
    '^.+\\.(js|ts|tsx)$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-typescript', { allExtensions: true }],
          ['@babel/preset-env', { targets: { node: 'current' } }],
        ],
      },
    ],
  },
  moduleNameMapper: {
    // Módulos nativos — no se usan en los tests del store, se mockean en el test
    'expo-secure-store': '<rootDir>/__mocks__/expo-secure-store.js',
    '^../../shared/api/client$': '<rootDir>/__mocks__/shared-api-client.js',
    '^../utils/notifications$': '<rootDir>/__mocks__/notifications.js',
  },
  testEnvironment: 'node',
};
