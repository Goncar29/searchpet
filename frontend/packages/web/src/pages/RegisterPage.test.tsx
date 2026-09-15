import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RegisterPage } from './RegisterPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const mockRegister = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    loginWithGoogle: vi.fn(),
    register: mockRegister,
    isAuthenticated: false,
    isLoading: false,
  }),
}));

// El paso real pide geolocalización; acá sólo interesa SI se muestra.
vi.mock('../components/auth/LocationOnboardingStep', () => ({
  LocationOnboardingStep: () => <div>paso-de-ubicacion</div>,
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRegister.mockResolvedValue(undefined);
});

describe('RegisterPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
    expect(document.body).toBeTruthy();
  });

  it('muestra el título de registro', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
    expect(screen.getByText('auth:register.title')).toBeTruthy();
  });

  it('muestra el botón de submit', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /auth:register.submit/i })).toBeTruthy();
  });

  it('muestra el link para ir al login', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /auth:register.hasAccount/i })).toBeTruthy();
  });
});

/**
 * LA CIUDAD ES OBLIGATORIA, y el alta termina en el paso de ubicación.
 *
 * Las dos mitades del mismo cambio: el campo da la CIUDAD (texto, para el
 * ranking) y el paso ofrece el GPS, que llena latitude/longitude — lo que usa
 * PostGIS para el feed cercano. Son dos datos distintos, no uno repetido.
 *
 * Medido antes de esto: 4 de 7 cuentas tenían la ciudad vacía, todas de alta
 * por email. Las de Google la cargan en su propio paso.
 */
describe('RegisterPage — ciudad obligatoria y paso de ubicación', () => {
  const llenar = async (user: ReturnType<typeof userEvent.setup>, conCiudad: boolean) => {
    await user.type(screen.getByLabelText('auth:register.name *'), 'Ana');
    await user.type(screen.getByLabelText('auth:register.email *'), 'ana@test.com');
    if (conCiudad) await user.type(screen.getByLabelText('auth:register.city *'), 'Montevideo');
    await user.type(screen.getByLabelText('auth:register.password *'), 'secreto1');
    await user.type(screen.getByLabelText('auth:register.confirm *'), 'secreto1');
    await user.click(screen.getByRole('button', { name: 'auth:register.submit' }));
  };

  it('sin ciudad NO registra y marca el campo', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);

    await llenar(user, false);

    // Lo que importa no es que aparezca un error, sino que NO se haya creado la
    // cuenta: una cuenta sin ciudad queda fuera de su propio ranking.
    expect(mockRegister).not.toHaveBeenCalled();
    expect(screen.getByLabelText('auth:register.city *')).toHaveAccessibleDescription('common:required');
  });

  it('con ciudad registra y va al paso de ubicación, no a la app', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);

    await llenar(user, true);

    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    // La ciudad viaja: es el quinto argumento de `register`.
    expect(mockRegister.mock.calls[0][4]).toBe('Montevideo');
    // Y el alta NO termina en la app: termina ofreciendo el GPS.
    await waitFor(() => expect(screen.getByText('paso-de-ubicacion')).toBeInTheDocument());
  });
});
