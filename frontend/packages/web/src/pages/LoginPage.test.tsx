import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { LoginPage } from './LoginPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es' },
  }),
}));

// Mock del contexto de auth
const mockLogin = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    isAuthenticated: false,
    isLoading: false,
  }),
}));

// React Router ya lo provee MemoryRouter — mock de useNavigate y useSearchParams
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams()],
  };
});

beforeEach(() => {
  vi.clearAllMocks();
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

  it('muestra error de API cuando login() falla', async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new Error('Credenciales inválidas'));
    renderLoginPage();

    await user.type(screen.getByLabelText('auth:login.email'), 'carlos@example.com');
    await user.type(screen.getByLabelText('auth:login.password'), 'incorrecta');
    await user.click(screen.getByRole('button', { name: 'auth:login.submit' }));

    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
  });
});
