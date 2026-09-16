import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RegisterPage } from './RegisterPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const mockRegister = vi.fn();

/**
 * `isAuthenticated` es VARIABLE, y esa es toda la diferencia.
 *
 * Con el `false` clavado que tenía antes, la rama `isAuthenticated && …` del
 * guard de redirección no podía evaluar truthy en ningún test — o sea que la
 * suite no distinguía entre el guard funcionando y el guard roto. Justo la
 * regresión que el comentario de esa línea dice venir a impedir.
 */
let mockAutenticado = false;

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    loginWithGoogle: vi.fn(),
    register: mockRegister,
    get isAuthenticated() {
      return mockAutenticado;
    },
    isLoading: false,
  }),
}));

// El paso real pide geolocalización; acá sólo interesa SI se muestra.
vi.mock('../components/auth/LocationOnboardingStep', () => ({
  LocationOnboardingStep: () => <div>paso-de-ubicacion</div>,
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockNavigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockAutenticado = false;
  mockRegister.mockResolvedValue(undefined);
  // El alta deja al usuario AUTENTICADO: es la condición que dispara el guard.
  mockRegister.mockImplementation(async () => {
    mockAutenticado = true;
  });
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
 * Las de Google la cargan en su propio paso.
 *
 * Acá decía "medido antes de esto: 4 de 7 cuentas tenían la ciudad vacía" y era
 * FALSO — ese conteo incluía filas de pruebas contra producción. Limpiadas el
 * 2026-09-16: 5 cuentas reales, ninguna sin ciudad.
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

  /**
   * EL TEST QUE FALTABA, y sin el cual el guard no estaba protegido por nada.
   *
   * `RegisterPage` redirige a `/` apenas detecta sesión. El alta con email deja
   * al usuario AUTENTICADO, así que sin la exclusión `!showLocationAfterSignup`
   * el guard dispara y el paso de ubicación no llega a renderizarse nunca.
   *
   * Los dos casos de arriba no podían ver eso: con `isAuthenticated` clavado en
   * `false`, la condición del guard era inalcanzable y la suite daba verde con
   * la exclusión puesta o sacada. Acá el `register` mockeado PRENDE la sesión,
   * que es lo que hace el real.
   */
  it('con la sesión ya abierta NO rebota a la app: el paso se renderiza igual', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);

    await llenar(user, true);

    await waitFor(() => expect(screen.getByText('paso-de-ubicacion')).toBeInTheDocument());
    // La prueba de que el guard NO disparó: nadie navegó a `/`.
    expect(mockNavigate).not.toHaveBeenCalledWith('/', { replace: true });
  });
});
