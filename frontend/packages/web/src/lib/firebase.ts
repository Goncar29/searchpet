import { initializeApp } from 'firebase/app';
import { getMessaging, type Messaging } from 'firebase/messaging';

// Credenciales públicas del proyecto Firebase (no son secretas — van al frontend)
// Configurar en .env.local o en Vercel → Environment Variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Inicializar Firebase solo si las credenciales están configuradas
const isConfigured = Object.values(firebaseConfig).every(Boolean);

export const firebaseApp = isConfigured ? initializeApp(firebaseConfig) : null;

// getMessaging solo funciona en navegadores que soportan Service Workers
export function getFirebaseMessaging(): Messaging | null {
  if (!firebaseApp) return null;
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;

  try {
    return getMessaging(firebaseApp);
  } catch {
    return null;
  }
}
