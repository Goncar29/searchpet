import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

// AuthProvider vacía la caché de React Query cuando cambia el usuario, así que
// necesita un QueryClientProvider arriba. Se crea uno NUEVO por render a
// propósito: compartirlo haría que el clear de un test se vea en el siguiente y
// los guards pasarían a depender del orden del archivo.
function Providers({ children, client: externo }: { children: React.ReactNode; client?: QueryClient }) {
  // `useState` con inicializador perezoso y no `new QueryClient()` suelto en el
  // cuerpo: así el cliente sobrevive a los re-renders del provider. Con una
  // instancia nueva por render, el efecto de AuthContext que depende de
  // `queryClient` se volvería a disparar en cada uno. En producción no aplica
  // porque `main.tsx` crea el cliente una sola vez a nivel de módulo.
  const [propio] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const client = externo ?? propio;
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
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
      <Providers>
        <AuthConsumer />
      </Providers>
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
      <Providers>
        <AuthConsumer />
      </Providers>
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
      <Providers>
        <LoginTrigger />
        <AuthConsumer />
      </Providers>
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
      <Providers>
        <LogoutTrigger />
        <AuthConsumer />
      </Providers>
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
      <Providers>
        <AuthConsumer />
      </Providers>
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
      <Providers>
        <AuthConsumer />
      </Providers>
    );
    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('Carlos');
  });

  // jsdom's window.location.assign is non-configurable, so vi.spyOn cannot wrap
  // it directly — the whole `location` object is replaced with a stub instead.
  function stubLocationAssign(pathname = '/', search = '') {
    const original = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, pathname, search, assign },
    });
    return {
      assign,
      restore: () => Object.defineProperty(window, 'location', { configurable: true, value: original }),
    };
  }

  it('hace navegacion forzada a /login cuando el 401 trae code session_expired', async () => {
    const location = stubLocationAssign();
    localStorage.setItem('token', 'stale-token');
    localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Carlos' }));

    render(
      <Providers>
        <AuthConsumer />
      </Providers>
    );
    await act(async () => {});

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('auth:session-expired', { detail: { code: 'session_expired' } })
      );
    });

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(location.assign).toHaveBeenCalledWith('/login?returnUrl=%2F');

    location.restore();
  });

  it('lleva la ruta actual como returnUrl para volver despues del login', async () => {
    // A forced logout should not cost the user their place. LoginPage already
    // reads `returnUrl` and navigates back on success; before this the redirect
    // dropped it and always dumped the user on the home page.
    const location = stubLocationAssign('/pets/123', '?tab=timeline');
    localStorage.setItem('token', 'stale-token');

    render(
      <Providers>
        <AuthConsumer />
      </Providers>
    );
    await act(async () => {});

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('auth:session-expired', { detail: { code: 'session_expired' } })
      );
    });

    expect(location.assign).toHaveBeenCalledWith(
      `/login?returnUrl=${encodeURIComponent('/pets/123?tab=timeline')}`
    );

    location.restore();
  });

  it('NO se pasa returnUrl a si mismo cuando ya estas en /login', async () => {
    // Otherwise signing in would navigate straight back to the login page.
    const location = stubLocationAssign('/login', '');
    localStorage.setItem('token', 'stale-token');

    render(
      <Providers>
        <AuthConsumer />
      </Providers>
    );
    await act(async () => {});

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('auth:session-expired', { detail: { code: 'session_expired' } })
      );
    });

    expect(location.assign).toHaveBeenCalledWith('/login');

    location.restore();
  });

  it('NO fuerza navegacion para un 401 generico sin code session_expired', async () => {
    const location = stubLocationAssign();
    localStorage.setItem('token', 'stale-token');
    localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Carlos' }));

    render(
      <Providers>
        <AuthConsumer />
      </Providers>
    );
    await act(async () => {});

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('auth:session-expired', { detail: { code: 'unauthorized' } })
      );
    });

    // The session is still cleared — this is not about session_expired's cleanup,
    // it is about NOT force-navigating away from wherever the user currently is
    // for a run-of-the-mill invalid/expired token.
    expect(localStorage.getItem('token')).toBeNull();
    expect(location.assign).not.toHaveBeenCalled();

    location.restore();
  });

  it('descarta una sesión con user corrupto sin colgar la carga', async () => {
    const valid = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem('token', valid);
    localStorage.setItem('user', '{ broken json');

    render(
      <Providers>
        <AuthConsumer />
      </Providers>
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
      <Providers>
        <GoogleConsumer onResult={onResult} />
      </Providers>,
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
      <Providers>
        <GoogleConsumer onResult={onResult} />
      </Providers>,
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
      <Providers>
        <GoogleConsumer onResult={vi.fn()} />
      </Providers>,
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
      <Providers>
        <AuthConsumer />
      </Providers>,
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
      <Providers>
        <AuthConsumer />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('Carlos');
  });

  // ── La caché no puede sobrevivir al cambio de usuario ──
  //
  // Se inspecciona el QueryClient DIRECTAMENTE y no por el DOM: `setQueryData`
  // no re-renderiza a quien no esté suscripto con `useQuery`, así que un span
  // que lo lea en render muestra el valor viejo y el test miente.

  function Disparador() {
    const { login, logout } = useAuth();
    return (
      <div>
        <button onClick={logout}>salir</button>
        <button onClick={() => login('b@b.com', 'x')}>entrar-B</button>
      </div>
    );
  }

  const nuevoClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it('cerrar sesion vacia la cache: el usuario siguiente no ve datos del anterior', async () => {
    // EL BUG QUE CIERRA, reportado por un usuario: cambiaba de cuenta y veia
    // "rastros" de la sesion anterior. Ninguna clave de query lleva el id del
    // usuario y cerrar sesion navega con el router SIN recargar, asi que la
    // cache del anterior se le servia al siguiente hasta que cada query
    // refetcheara. No es cosmetico: son conversaciones y nombres ajenos.
    const client = nuevoClient();
    localStorage.setItem('token', 'tok-A');
    localStorage.setItem('user', JSON.stringify({ id: 'user-A', name: 'Ana' }));

    render(
      <Providers client={client}>
        <Disparador />
      </Providers>
    );
    await act(async () => {});

    client.setQueryData(['messages'], 'datos-del-usuario-A');
    expect(client.getQueryData(['messages'])).toBe('datos-del-usuario-A');

    await act(async () => { screen.getByText('salir').click(); });

    expect(client.getQueryData(['messages'])).toBeUndefined();
  });

  it('cambiar de cuenta sin pasar por logout tampoco arrastra la cache', async () => {
    const { apiClient } = await import('@shared/api/client');
    vi.mocked(apiClient.login).mockResolvedValue({
      token: 'tok-B',
      user: { id: 'user-B', email: 'b@b.com', name: 'Bruno', is_verified: false, created_at: '' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const client = nuevoClient();
    localStorage.setItem('token', 'tok-A');
    localStorage.setItem('user', JSON.stringify({ id: 'user-A', name: 'Ana' }));

    render(
      <Providers client={client}>
        <Disparador />
      </Providers>
    );
    await act(async () => {});

    client.setQueryData(['messages'], 'datos-del-usuario-A');

    // A -> B directo. Un clear colgado sólo de `logout` no cubriria este camino,
    // y es uno de los SEIS que cambian de identidad.
    await act(async () => { screen.getByText('entrar-B').click(); });

    expect(client.getQueryData(['messages'])).toBeUndefined();
  });

  it('montar con sesion ya guardada NO vacia la cache', async () => {
    // La guarda `anterior !== null` existe para esto: sin ella, la hidratacion
    // inicial (null -> usuario) dispararia un clear en CADA carga de pagina y
    // con el una tanda entera de refetches. Es seguro saltearla porque una
    // carga de pagina estrena un QueryClient vacio.
    const client = nuevoClient();
    client.setQueryData(['messages'], 'sembrado-antes-de-montar');
    localStorage.setItem('token', 'tok-A');
    localStorage.setItem('user', JSON.stringify({ id: 'user-A', name: 'Ana' }));

    render(
      <Providers client={client}>
        <Disparador />
      </Providers>
    );
    await act(async () => {});

    expect(client.getQueryData(['messages'])).toBe('sembrado-antes-de-montar');
  });
});
