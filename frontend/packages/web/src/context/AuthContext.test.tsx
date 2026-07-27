import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

// Mock del apiClient — nunca sale a la red
vi.mock('@shared/api/client', () => ({
  apiClient: {
    login: vi.fn(),
    register: vi.fn(),
    loginWithGoogle: vi.fn(),
    getMe: vi.fn().mockRejectedValue(new Error('not stubbed')),
    setToken: vi.fn(),
    logout: vi.fn(),
  },
}));

// Mock de Firebase notifications — no disponible en jsdom
vi.mock('../utils/notifications', () => ({
  registerWebPushToken: vi.fn(),
  listenForegroundMessages: vi.fn(),
}));

// Builds an unsigned JWT-shaped string with the given payload (base64url).
function makeJwt(payload: object): string {
  const enc = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

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

  it('no restaura una sesión con token JWT expirado y limpia localStorage', async () => {
    const expired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 100 });
    localStorage.setItem('token', expired);
    localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Carlos' }));

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );
    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('restaura una sesión con token JWT vigente', async () => {
    const valid = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem('token', valid);
    localStorage.setItem('user', JSON.stringify({ id: '1', email: 'a@a.com', name: 'Carlos', is_verified: false, created_at: '' }));

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );
    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('Carlos');
  });

  it('descarta una sesión con user corrupto sin colgar la carga', async () => {
    const valid = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem('token', valid);
    localStorage.setItem('user', '{ broken json');

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );
    await act(async () => {});

    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});

describe('AuthContext.loginWithGoogle', () => {
  // Exposes loginWithGoogle so a test can drive it and read what it returned.
  function GoogleConsumer({ onResult }: { onResult: (isNew: boolean) => void }) {
    const { loginWithGoogle, isAuthenticated, user } = useAuth();
    return (
      <div>
        <button
          type="button"
          // .catch mirrors useGoogleSignIn, which wraps the call in try/catch.
          onClick={() => void loginWithGoogle('fake-id-token').then(onResult).catch(() => {})}
        >
          go
        </button>
        <span data-testid="auth">{String(isAuthenticated)}</span>
        <span data-testid="user">{user?.name ?? 'none'}</span>
      </div>
    );
  }

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('stores the session and passes is_new_user through', async () => {
    const { apiClient } = await import('@shared/api/client');
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    vi.mocked(apiClient.loginWithGoogle).mockResolvedValue({
      token,
      user: { id: 'u1', email: 'carlos@example.com', name: 'Carlos', is_verified: true, created_at: '' },
      is_new_user: true,
    });

    const onResult = vi.fn();
    render(
      <AuthProvider>
        <GoogleConsumer onResult={onResult} />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'go' }).click();
    });

    // The flag is the ONLY signal the pages use to decide onboarding vs redirect.
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('Carlos');
    expect(localStorage.getItem('token')).toBe(token);
    expect(JSON.parse(localStorage.getItem('user') ?? '{}').name).toBe('Carlos');
  });

  it('returns false for a returning user', async () => {
    const { apiClient } = await import('@shared/api/client');
    vi.mocked(apiClient.loginWithGoogle).mockResolvedValue({
      token: makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      user: { id: 'u1', email: 'carlos@example.com', name: 'Carlos', is_verified: true, created_at: '' },
      is_new_user: false,
    });

    const onResult = vi.fn();
    render(
      <AuthProvider>
        <GoogleConsumer onResult={onResult} />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'go' }).click();
    });

    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('leaves no session behind when the request fails', async () => {
    const { apiClient } = await import('@shared/api/client');
    vi.mocked(apiClient.loginWithGoogle).mockRejectedValue(new Error('401'));

    render(
      <AuthProvider>
        <GoogleConsumer onResult={vi.fn()} />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'go' }).click();
    });

    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(localStorage.getItem('token')).toBeNull();
  });
});

describe('AuthContext — reconciliación con el servidor', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('refresca el usuario cacheado al montar (la foto de Google llega tarde)', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    // Lo guardado en el login NO tiene foto: la importación del avatar corre
    // fuera del camino de respuesta y termina después de emitir el token.
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Carlos', profile_photo_url: '' }));

    const { apiClient } = await import('@shared/api/client');
    vi.mocked(apiClient.getMe).mockResolvedValue({
      id: 'u1', email: 'carlos@example.com', name: 'Carlos',
      profile_photo_url: 'https://res.cloudinary.com/searchpet/avatar.webp',
      is_verified: true, created_at: '',
    });

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('user') ?? '{}').profile_photo_url)
        .toBe('https://res.cloudinary.com/searchpet/avatar.webp'),
    );
  });

  it('NO borra el usuario cacheado si el servidor responde algo inválido', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Carlos' }));

    const { apiClient } = await import('@shared/api/client');
    // @ts-expect-error — probando deliberadamente una respuesta malformada
    vi.mocked(apiClient.getMe).mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('Carlos');
  });
});
