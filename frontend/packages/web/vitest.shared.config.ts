/// <reference types="vitest" />
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@testing-library/react': path.resolve(__dirname, 'node_modules/@testing-library/react'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../shared'),
    include: ['**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**'],
  },
});
