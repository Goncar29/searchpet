// ============================================================
// SearchPet - Estado global (Zustand)
// ============================================================

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { getDevicePushTokenAsync } from 'expo-notifications';
import { router } from 'expo-router';
import type { User } from '../../shared/types';
import { apiClient } from '../../shared/api/client';
import { isJwtExpired } from '../../shared/utils/jwt';
import { registerPushToken } from '../utils/notifications';

// ============================================================
// AUTH STORE
// ============================================================

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  /** Devuelve `is_new_user` para que la pantalla decida si pedir ubicación. */
  loginWithGoogle: (idToken: string) => Promise<boolean>;
  register: (email: string, password: string, name: string, phone?: string, city?: string) => Promise<void>;
  logout: () => Promise<void>;
  loadToken: () => Promise<void>;
  setUser: (user: User) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (email, password) => {
    try {
      const response = await apiClient.login({ email, password });
      await SecureStore.setItemAsync('auth_token', response.token);
      await SecureStore.setItemAsync('user_data', JSON.stringify(response.user));
      apiClient.setToken(response.token);

      set({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
      });

      // Registrar token FCM — falla silenciosamente si el usuario denegó permisos
      registerPushToken();
    } catch (error) {
      throw error;
    }
  },

  loginWithGoogle: async (idToken) => {
    // Mismo contrato que `login`: persistir, setear el token del cliente y
    // registrar FCM. Sin el registerPushToken() el usuario entra pero nunca
    // recibe una alerta de mascota cerca.
    const response = await apiClient.loginWithGoogle(idToken);
    await SecureStore.setItemAsync('auth_token', response.token);
    await SecureStore.setItemAsync('user_data', JSON.stringify(response.user));
    apiClient.setToken(response.token);

    set({
      user: response.user,
      token: response.token,
      isAuthenticated: true,
    });

    // Registrar token FCM — falla silenciosamente si el usuario denegó permisos
    registerPushToken();

    return response.is_new_user;
  },

  register: async (email, password, name, phone, city) => {
    try {
      const response = await apiClient.register({ email, password, name, phone, city });
      await SecureStore.setItemAsync('auth_token', response.token);
      await SecureStore.setItemAsync('user_data', JSON.stringify(response.user));
      apiClient.setToken(response.token);

      set({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
      });

      // Registrar token FCM — falla silenciosamente si el usuario denegó permisos
      registerPushToken();
    } catch (error) {
      throw error;
    }
  },

  logout: async () => {
    // Fire-and-forget: limpiar el token FCM antes de desloguear.
    // Si falla (sin permisos, simulador, red caída) el logout continúa igual.
    try {
      const pushToken = await getDevicePushTokenAsync();
      if (pushToken?.data) {
        apiClient.deleteDeviceToken(pushToken.data).catch(() => {});
      }
    } catch {
      // Sin token de dispositivo — saltar el DELETE silenciosamente
    }

    await SecureStore.deleteItemAsync('auth_token');
    await SecureStore.deleteItemAsync('user_data');
    apiClient.setToken(null);

    set({
      user: null,
      token: null,
      isAuthenticated: false,
    });
  },

  setUser: async (user) => {
    await SecureStore.setItemAsync('user_data', JSON.stringify(user));
    set({ user });
  },

  loadToken: async () => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      const userData = await SecureStore.getItemAsync('user_data');

      // Solo rehidratamos una sesión cuyo token NO haya expirado — de lo
      // contrario la app arrancaría mostrando al usuario logueado hasta que el
      // primer request reciba un 401. El backend valida la firma igual.
      if (token && userData && !isJwtExpired(token)) {
        apiClient.setToken(token);
        set({
          token,
          user: JSON.parse(userData),
          isAuthenticated: true,
          isLoading: false,
        });
        // Refrescar token FCM en cold start — falla silenciosamente
        registerPushToken().catch(() => {});
      } else {
        // Sin sesión, o una expirada/parcial — limpiamos cualquier token viejo
        // para que un token muerto nunca aparezca activo, y terminamos la carga.
        if (token || userData) {
          await SecureStore.deleteItemAsync('auth_token');
          await SecureStore.deleteItemAsync('user_data');
        }
        set({ isLoading: false });
      }
    } catch {
      // Sesión persistida corrupta (p. ej. user_data con JSON inválido) — la
      // descartamos para no quedar trabados re-explotando el parse en cada
      // cold start. El cleanup es best-effort: si el error vino de la lectura
      // de SecureStore, el delete puede fallar también y lo ignoramos.
      try {
        await SecureStore.deleteItemAsync('auth_token');
        await SecureStore.deleteItemAsync('user_data');
      } catch {
        // ignore
      }
      set({ isLoading: false });
    }
  },
}));

// ============================================================
// SESSION EXPIRY — mobile parity with web's AuthContext.tsx listener
// ============================================================
//
// The shared api client (frontend/packages/shared/api/client.ts) reacts to
// every 401 by calling `window.dispatchEvent(new CustomEvent('auth:session-
// expired', { detail: { code } }))`. That works on web because a browser
// provides `window.addEventListener`/`dispatchEvent` and `CustomEvent` out of
// the box. React Native does NOT: `react-native/Libraries/Core/
// setUpGlobals.js` sets `global.window = global` (so `typeof window !==
// 'undefined'` is true), but nothing in React Native's core ever attaches
// `addEventListener`/`dispatchEvent`/`CustomEvent` to that object — those are
// DOM APIs, not part of the ECMAScript spec Hermes implements, and RN's own
// setup files only ever add `alert`, `navigator`, `performance` and
// `process`. Left unpatched, the client's dispatch call throws on a real
// device before the intended `ApiError` is even thrown, so `session_expired`
// could never reach here.
//
// This is scoped to the mobile app only (not `shared/`, which web also uses,
// and whose existing behaviour/tests must not change): a minimal shim gives
// `global` (== `window`) just enough of the DOM Event contract for the
// client's existing dispatch call to work.
type SessionExpiredListener = (event: { type: string; detail?: { code?: string } }) => void;

const globalScope = globalThis as unknown as {
  window?: unknown;
  CustomEvent?: new (type: string, params?: { detail?: unknown }) => unknown;
  addEventListener?: (type: string, listener: SessionExpiredListener) => void;
  removeEventListener?: (type: string, listener: SessionExpiredListener) => void;
  dispatchEvent?: (event: { type: string }) => boolean;
};

if (typeof globalScope.window === 'undefined') {
  globalScope.window = globalScope;
}

if (typeof globalScope.CustomEvent === 'undefined') {
  class CustomEventPolyfill<T = unknown> {
    type: string;
    detail: T | undefined;
    constructor(type: string, params?: { detail?: T }) {
      this.type = type;
      this.detail = params?.detail;
    }
  }
  globalScope.CustomEvent = CustomEventPolyfill as unknown as typeof globalScope.CustomEvent;
}

if (typeof globalScope.addEventListener !== 'function') {
  const listenersByType = new Map<string, Set<SessionExpiredListener>>();
  globalScope.addEventListener = (type, listener) => {
    if (!listenersByType.has(type)) listenersByType.set(type, new Set());
    listenersByType.get(type)!.add(listener);
  };
  globalScope.removeEventListener = (type, listener) => {
    listenersByType.get(type)?.delete(listener);
  };
  globalScope.dispatchEvent = (event) => {
    listenersByType.get(event.type)?.forEach((listener) => listener(event as Parameters<SessionExpiredListener>[0]));
    return true;
  };
}

// `session_expired` specifically means the JWT predates a password change
// (backend middleware.Auth) — that token will NEVER work again. Dropping
// local state is not enough: the request that surfaced this could have fired
// from any screen, so we also force navigation to /login (mirrors
// AuthContext.tsx on web). A run-of-the-mill 401 (bad/missing token) does not
// reach this branch on purpose — the app's normal auth guard already handles
// that per screen, and wiping a live session on every unrelated 401 would be
// disruptive for no security reason.
globalScope.addEventListener!('auth:session-expired', (event) => {
  const code = event.detail?.code;
  if (code !== 'session_expired') return;

  SecureStore.deleteItemAsync('auth_token').catch(() => {});
  SecureStore.deleteItemAsync('user_data').catch(() => {});
  apiClient.setToken(null);
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  router.replace('/login');
});

// ============================================================
// LANGUAGE STORE
// ============================================================

interface LanguageState {
  language: string;
  setLanguage: (lang: string) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: 'es',
  setLanguage: (lang) => set({ language: lang }),
}));

// ============================================================
// LOCATION STORE
// ============================================================

interface LocationState {
  latitude: number | null;
  longitude: number | null;
  setLocation: (lat: number, lng: number) => void;
}

export const useLocationStore = create<LocationState>((set) => ({
  latitude: null,
  longitude: null,
  setLocation: (lat, lng) => set({ latitude: lat, longitude: lng }),
}));
