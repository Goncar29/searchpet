import { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '@shared/api/client';
import type { User } from '@shared/types';
import { registerWebPushToken, listenForegroundMessages } from '../utils/notifications';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, phone?: string, city?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Al iniciar, recuperamos el token de localStorage si existe.
  // isLoading evita que ProtectedRoute redirija antes de que este efecto termine.
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      apiClient.setToken(savedToken);
    }
    setIsLoading(false);
  }, []);

  // Escuchar notificaciones en primer plano cuando el usuario está autenticado.
  // El listener se limpia al hacer logout o desmontar el componente.
  useEffect(() => {
    if (!token) return;
    const unsubscribe = listenForegroundMessages();
    return () => { unsubscribe?.(); };
  }, [token]);

  const login = async (email: string, password: string) => {
    const resp = await apiClient.login({ email, password });
    setToken(resp.token);
    setUser(resp.user);
    localStorage.setItem('token', resp.token);
    localStorage.setItem('user', JSON.stringify(resp.user));
    // Registrar token FCM — en background, falla silenciosamente
    registerWebPushToken();
  };

  const register = async (email: string, password: string, name: string, phone?: string, city?: string) => {
    const resp = await apiClient.register({ email, password, name, phone, city });
    setToken(resp.token);
    setUser(resp.user);
    localStorage.setItem('token', resp.token);
    localStorage.setItem('user', JSON.stringify(resp.user));
    // Registrar token FCM — en background, falla silenciosamente
    registerWebPushToken();
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    apiClient.logout();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  const refreshUser = async () => {
    try {
      const updated = await apiClient.getMe();
      setUser(updated);
      localStorage.setItem('user', JSON.stringify(updated));
    } catch {
      // Si falla, mantenemos el usuario actual
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, refreshUser, isAuthenticated: !!token, isAdmin: user?.is_admin ?? false, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook para usar el contexto fácilmente en cualquier componente
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
