import { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '@shared/api/client';

interface User {
  id: string;
  email: string;
  name: string;
  is_verified: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Al iniciar, recuperamos el token de localStorage si existe
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      apiClient.setToken(savedToken);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const resp = await apiClient.login({ email, password });
    setToken(resp.token);
    setUser(resp.user);
    localStorage.setItem('token', resp.token);
    localStorage.setItem('user', JSON.stringify(resp.user));
  };

  const register = async (email: string, password: string, name: string) => {
    const resp = await apiClient.register({ email, password, name });
    setToken(resp.token);
    setUser(resp.user);
    localStorage.setItem('token', resp.token);
    localStorage.setItem('user', JSON.stringify(resp.user));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    apiClient.logout();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, isAuthenticated: !!token }}>
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
