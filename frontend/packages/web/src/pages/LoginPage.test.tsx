import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { LoginPage } from './LoginPage';
import { ApiError } from '@shared/api/client';

const errorTranslations: Record<string, string> = {
  'errors:invalid_credentials': 'Credenciales inválidas',
  'errors:unknown_error': 'Ocurrió un error inesperado',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => errorTranslations[key] ?? key,
    i18n: { language: 'es' },
  }),
}));

// Mock del contexto de auth
const mockLogin = vi.fn();
const routerState = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: new URLSearchParams(),
  isAuthenticated: false,
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    loginWithGoogle: vi.fn(),
    login: mockLogin,
    isAuthenticated: routerState.isAuthenticated,
    isLoading: false,
  }),
}));

// React Router ya lo provee MemoryRouter — mock de useNavigate y useSearchParams
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => routerState.navigate,
    useSearchParams: () => [routerState.search],
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  routerState.search = new URLSearchParams();
  routerState.isAuthenticated = false;
});

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe('LoginPage — validación de formulario', () => {
  it('muestra errores requeridos cuando email y password están vacíos', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(screen.getByRole('button', { name: 'auth:login.submit' }));

    // Ambos campos vacíos → dos errores "required"
    const errors = screen.getAllByText('common:required');
    expect(errors).toHaveLength(2);
  });

  it('muestra error de formato cuando el email es inválido', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText('auth:login.email'), 'no-es-email');
    await user.click(screen.getByRole('button', { name: 'auth:login.submit' }));

    expect(screen.getByText('common:emailInvalid')).toBeInTheDocument();
  });

  it('muestra error cuando la contraseña está vacía', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText('auth:login.email'), 'carlos@example.com');
    await user.click(screen.getByRole('button', { name: 'auth:login.submit' }));

    expect(screen.getByText('common:required')).toBeInTheDocument();
  });

  it('llama a login() con email y password correctos en submit válido', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue(undefined);
    renderLoginPage();

    await user.type(screen.getByLabelText('auth:login.email'), 'carlos@example.com');
    await user.type(screen.getByLabelText('auth:login.password'), 'mi-password');
    await user.click(screen.getByRole('button', { name: 'auth:login.submit' }));

    expect(mockLogin).toHaveBeenCalledOnce();
    expect(mockLogin).toHaveBeenCalledWith('carlos@example.com', 'mi-password');
  });

  it('muestra el aviso que deja ForgotPasswordPage al terminar el reset', () => {
    // Sin esto el usuario completa todo el flujo de recuperación y aterriza en un
    // formulario pelado, sin ninguna señal de que la contraseña se cambió.
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/login', state: { notice: 'Contraseña actualizada' } }]}
      >
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('status')).toHaveTextContent('Contraseña actualizada');
  });

  it('explica que la cuenta fue suspendida cuando llega con reason=banned', () => {
    // AuthContext sends a banned user here when the API answers user_banned.
    // Without this the session just vanishes with no explanation.
    routerState.search = new URLSearchParams('reason=banned');
    renderLoginPage();

    expect(screen.getByRole('alert')).toHaveTextContent('errors:user_banned');
  });

  it('no muestra el aviso de suspensión por cualquier otro reason', () => {
    routerState.search = new URLSearchParams('reason=whatever');
    renderLoginPage();

    expect(screen.queryByText('errors:user_banned')).not.toBeInTheDocument();
  });

  it('no muestra ningún aviso cuando se entra a /login directamente', () => {
    renderLoginPage();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('muestra error de API cuando login() falla', async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new ApiError('invalid_credentials', 401, 'Credenciales inválidas'));
    renderLoginPage();

    await user.type(screen.getByLabelText('auth:login.email'), 'carlos@example.com');
    await user.type(screen.getByLabelText('auth:login.password'), 'incorrecta');
    await user.click(screen.getByRole('button', { name: 'auth:login.submit' }));

    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
  });
});

// S12: `returnUrl` sale de la URL, así que cualquiera puede armar un link a
// /login con el valor que quiera. Sólo se navega a un path del mismo origen.
describe('LoginPage — returnUrl', () => {
  async function submitLogin() {
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLoginPage();
    await user.type(screen.getByLabelText('auth:login.email'), 'carlos@example.com');
    await user.type(screen.getByLabelText('auth:login.password'), 'mi-password');
    await user.click(screen.getByRole('button', { name: 'auth:login.submit' }));
  }

  it('después del login vuelve al path del mismo origen que trae returnUrl', async () => {
    routerState.search = new URLSearchParams({ returnUrl: '/pets/123' });
    await submitLogin();
    expect(routerState.navigate).toHaveBeenCalledWith('/pets/123', { replace: true });
  });

  it('después del login ignora un returnUrl a otro origen y va a /', async () => {
    routerState.search = new URLSearchParams({ returnUrl: '//evil.example' });
    await submitLogin();
    expect(routerState.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  // Los casos "con sesión ya iniciada" viven en authRedirect.test.tsx: necesitan
  // el router real, que acá está mockeado.
});
