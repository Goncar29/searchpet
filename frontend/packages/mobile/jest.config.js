'use strict';

module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.(ts|tsx|js)'],
  moduleNameMapper: {
    '^../../shared/api/client$': '<rootDir>/__mocks__/shared-api-client.js',
    '^../utils/notifications$': '<rootDir>/__mocks__/notifications.js',
  },
};
