/// <reference types="vitest" />
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@testing-library/react': path.resolve(__dirname, 'node_modules/@testing-library/react'),
      '@tanstack/react-query': path.resolve(__dirname, 'node_modules/@tanstack/react-query'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [path.resolve(__dirname, 'vitest.shared.setup.ts')],
    root: path.resolve(__dirname, '../shared'),
    include: ['**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/hooks/useImageClassify.test.ts'],
  },
});
