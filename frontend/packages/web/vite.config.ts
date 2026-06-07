/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';

// Genera public/firebase-messaging-sw.js desde el template, inyectando env vars.
// Así nunca hay credenciales hardcodeadas en el repo.
function firebaseSwPlugin(): Plugin {
  return {
    name: 'firebase-sw-generator',
    apply: 'build',
    buildStart() {
      const env = loadEnv('production', process.cwd(), '');
      generateSW(env);
    },
    configureServer() {
      const env = loadEnv('development', process.cwd(), '');
      generateSW(env);
    },
  };
}

function generateSW(env: Record<string, string>) {
  const templatePath = path.resolve(__dirname, 'src/firebase-messaging-sw.template.js');
  const outputPath = path.resolve(__dirname, 'public/firebase-messaging-sw.js');

  if (!fs.existsSync(templatePath)) return;

  const replacements: Record<string, string> = {
    '__VITE_FIREBASE_API_KEY__': env.VITE_FIREBASE_API_KEY ?? '',
    '__VITE_FIREBASE_AUTH_DOMAIN__': env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    '__VITE_FIREBASE_PROJECT_ID__': env.VITE_FIREBASE_PROJECT_ID ?? '',
    '__VITE_FIREBASE_STORAGE_BUCKET__': env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    '__VITE_FIREBASE_MESSAGING_SENDER_ID__': env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    '__VITE_FIREBASE_APP_ID__': env.VITE_FIREBASE_APP_ID ?? '',
  };

  let content = fs.readFileSync(templatePath, 'utf-8');
  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.replaceAll(placeholder, value);
  }
  fs.writeFileSync(outputPath, content, 'utf-8');
}

export default defineConfig({
  plugins: [react(), tailwindcss(), firebaseSwPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
      '@tanstack/react-query': path.resolve(__dirname, 'node_modules/@tanstack/react-query'),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
});
