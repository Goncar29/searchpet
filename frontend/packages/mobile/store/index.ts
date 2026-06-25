// ============================================================
// SearchPet - Estado global (Zustand)
// ============================================================

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { getDevicePushTokenAsync } from 'expo-notifications';
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
