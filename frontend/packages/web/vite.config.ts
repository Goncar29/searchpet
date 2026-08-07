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

// Vercel sirve /_vercel/* (el script de Speed Insights y su beacon) desde su
// propia infraestructura. Fuera de Vercel esa ruta no existe, y el fallback SPA
// de vite devuelve index.html — así que el navegador recibe HTML donde esperaba
// JavaScript y tira `Unexpected token '<'`.
//
// Eso rompió el E2E de verdad: map.spec.ts afirma que no hay errores de consola
// y fallaba, también en el reintento. Y es exactamente lo que la regla #28
// prohíbe para el service worker: NUNCA devolver index.html ante un asset,
// porque el navegador lo rechaza por MIME y falla en silencio.
//
// Contestar 404 es lo honesto: la ruta no existe en este entorno. El script no
// carga, Speed Insights no mide nada fuera de Vercel —que es lo correcto— y
// nadie recibe HTML disfrazado de JS.
function vercelPaths404(): Plugin {
  const cortar = (req: { url?: string }, res: { statusCode: number; end: () => void }, next: () => void) => {
    if (req.url?.startsWith('/_vercel/')) {
      res.statusCode = 404;
      res.end();
      return;
    }
    next();
  };
  return {
    name: 'vercel-paths-404',
    configureServer(server) {
      server.middlewares.use(cortar);
    },
    configurePreviewServer(server) {
      server.middlewares.use(cortar);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), firebaseSwPlugin(), vercelPaths404()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
      '@tanstack/react-query': path.resolve(__dirname, 'node_modules/@tanstack/react-query'),
      // TF.js packages imported dynamically from shared/hooks/useImageClassify.ts:
      // vite resolves them from the importer (shared/, outside this package root),
      // so they need explicit aliases — same reason as @tanstack/react-query above.
      // tfjs-react-native is mobile-only; web stubs it (the RN branch never runs on web).
      '@tensorflow/tfjs-react-native': path.resolve(__dirname, 'src/stubs/tfjs-react-native-stub.js'),
      '@tensorflow/tfjs': path.resolve(__dirname, 'node_modules/@tensorflow/tfjs'),
      '@tensorflow-models/mobilenet': path.resolve(__dirname, 'node_modules/@tensorflow-models/mobilenet'),
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
