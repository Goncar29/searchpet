// ============================================================
// SearchPet - Estado global (Zustand)
// ============================================================

// MUST stay the first import, and must NOT be removed on the grounds that
// `app/_layout.tsx` already imports it. This module registers a global listener
// at evaluation time, so it has to install the globals itself instead of trusting
// somebody else to have gone first — and that trust was misplaced: expo-router
// calls `loadRoute()` eagerly for every layout while building the route tree, and
// Metro sorts the context keys, so `app/(tabs)/_layout.tsx` ('(' = 0x28) is
// evaluated BEFORE `app/_layout.tsx` ('_' = 0x5F). That group layout imports this
// store, so the listener used to register against a global scope the root layout
// had not patched yet — it silently never registered, on device and in prod.
// ES module imports are idempotent, so the duplicate with the root layout is free.
import '../polyfills/domEvents';

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
// The shared api client announces a rejected token by dispatching the DOM event
// `auth:session-expired`. React Native provides none of the APIs that needs — see
// `polyfills/domEvents.ts` for the details and the verification. That module is
// imported first in `app/_layout.tsx`; it is NOT imported here, because a state
// store patching globals as an import side effect is invisible to whoever reads
// the store later.
//
// `session_expired` specifically means the JWT predates a password change
// (backend `middleware.Auth`) — that token will NEVER work again. Dropping local
// state is not enough: the request that surfaced it could have fired from any
// screen, so we force navigation to /login too (mirrors `AuthContext.tsx` on web).
// A run-of-the-mill 401 (bad or missing token) deliberately does not reach this
// branch: the per-screen auth guard already handles that, and wiping a live
// session on every unrelated 401 would be disruptive for no security gain.
type SessionExpiredEvent = { type: string; detail?: { code?: string } };

const eventTarget = globalThis as unknown as {
  addEventListener?: (type: string, listener: (event: SessionExpiredEvent) => void) => void;
};

if (typeof eventTarget.addEventListener === 'function') {
  eventTarget.addEventListener('auth:session-expired', (event) => {
    if (event.detail?.code !== 'session_expired') return;

    SecureStore.deleteItemAsync('auth_token').catch(() => {});
    SecureStore.deleteItemAsync('user_data').catch(() => {});
    apiClient.setToken(null);
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
    router.replace('/login');
  });
} else {
  // Unreachable while the `../polyfills/domEvents` import at the top of this file
  // stays put — it installs addEventListener before this line runs, regardless of
  // which module the bundler happens to evaluate first. Kept as a tripwire: this
  // branch is what a device silently fell into for as long as the registration
  // depended on app/_layout.tsx having been evaluated first.
  console.warn(
    '[store] no addEventListener on the global scope — session-expiry handling is INACTIVE. ' +
      "Is polyfills/domEvents.ts still the first import of store/index.ts?",
  );
}

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
