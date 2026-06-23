import './i18n/index';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { createQueryClient } from './lib/queryClient';
import { apiClient } from '@shared/api/client';
import App from './App';
import 'leaflet/dist/leaflet.css';
import './index.css';

// Bootstrap the auth token synchronously BEFORE the first render. The apiClient
// is a singleton whose token lives in memory and is reset on every full page
// load. AuthContext restores it from localStorage, but only in a post-render
// effect — so the very first queries on a fresh load (e.g. StoriesPage, a public
// route that still enriches liked_by_me per viewer) would otherwise fire without
// the Authorization header. Setting it here closes that hydration race; the
// AuthProvider re-applies the same token for React state.
const savedToken = localStorage.getItem('token');
if (savedToken) {
  apiClient.setToken(savedToken);
}

const queryClient = createQueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ThemeProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </ThemeProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </HelmetProvider>
  </React.StrictMode>
);

// Registrar Service Worker para PWA (solo en producción o localhost)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.error('[SW] Error al registrar:', err));
  });
}
