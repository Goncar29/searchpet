import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

// Mock del apiClient — nunca sale a la red
vi.mock('@shared/api/client', () => ({
  apiClient: {
    login: vi.fn(),
    register: vi.fn(),
    getMe: vi.fn(),
    setToken: vi.fn(),
    logout: vi.fn(),
  },
}));

// Mock de Firebase notifications — no disponible en jsdom
vi.mock('../utils/notifications', () => ({
  registerWebPushToken: vi.fn(),
}));

// Componente auxiliar que expone el contexto
function AuthConsumer() {
  const { user, isAuthenticated, isLoading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="auth">{String(isAuthenticated)}</span>
      <span data-testid="user">{user?.name ?? 'none'}</span>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('AuthContext', () => {
  it('inicia sin usuario autenticado cuando localStorage está vacío', async () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    // Esperar a que termine el efecto de inicialización
    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('recupera sesión de localStorage al montar', async () => {
    const mockUser = { id: '1', email: 'test@test.com', name: 'Carlos', is_verified: false, created_at: '' };
    localStorage.setItem('token', 'saved-token');
    localStorage.setItem('user', JSON.stringify(mockUser));

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('Carlos');
  });

  it('login() guarda token y usuario en localStorage', async () => {
    const { apiClient } = await import('@shared/api/client');
    const mockResponse = {
      token: 'jwt-token',
      user: { id: '1', email: 'test@test.com', name: 'Carlos', is_verified: false, created_at: '' },
    };
    vi.mocked(apiClient.login).mockResolvedValue(mockResponse as any);

    function LoginTrigger() {
      const { login } = useAuth();
      return <button onClick={() => login('test@test.com', '123456')}>Login</button>;
    }

    const { getByRole } = render(
      <AuthProvider>
        <LoginTrigger />
        <AuthConsumer />
      </AuthProvider>
    );

    await act(async () => {
      getByRole('button').click();
    });

    expect(localStorage.getItem('token')).toBe('jwt-token');
    expect(JSON.parse(localStorage.getItem('user')!).name).toBe('Carlos');
    expect(screen.getByTestId('auth').textContent).toBe('true');
  });

  it('logout() limpia localStorage y desautentica', async () => {
    localStorage.setItem('token', 'existing-token');
    localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Carlos' }));

    function LogoutTrigger() {
      const { logout } = useAuth();
      return <button onClick={logout}>Logout</button>;
    }

    const { getByRole } = render(
      <AuthProvider>
        <LogoutTrigger />
        <AuthConsumer />
      </AuthProvider>
    );

    await act(async () => {});
    await act(async () => { getByRole('button').click(); });

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(screen.getByTestId('auth').textContent).toBe('false');
  });
});
