import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';

/**
 * El guard de "ya tenés sesión" de LoginPage y RegisterPage, con el router REAL.
 *
 * Los tests de cada página mockean `useNavigate`, y eso los dejaba ciegos a dos
 * cosas a la vez:
 *
 * 1. El guard llamaba a `navigate()` en pleno render. Con el router de verdad
 *    eso le cambia el estado a BrowserRouter mientras React renderiza la
 *    página, y React lo denuncia con "Cannot update a component while
 *    rendering a different component". Con un `vi.fn()` no hay estado que
 *    cambiar, así que el warning no salía nunca en la suite (se vio manejando
 *    la app en el navegador, el 2026-10-08).
 * 2. Afirmar que el guard NO redirigió con `expect(mockNavigate).not...` deja
 *    de probar nada en cuanto la redirección pasa a ser un `<Navigate>`, que no
 *    usa el `useNavigate` mockeado: daría verde redirigiendo.
 *
 * Por eso acá se mira A QUÉ RUTA SE LLEGA, que es lo que ve el usuario.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const auth = vi.hoisted(() => ({ autenticado: false }));
const mockRegister = vi.fn();
const mockLogin = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    register: mockRegister,
    loginWithGoogle: vi.fn(),
    get isAuthenticated() {
      return auth.autenticado;
    },
    isLoading: false,
  }),
}));

// El botón de Google carga un script de accounts.google.com; acá no interesa.
vi.mock('../components/auth/GoogleAuthPanel', () => ({ GoogleAuthPanel: () => null }));
vi.mock('../components/auth/LocationOnboardingStep', () => ({
  LocationOnboardingStep: () => <div>paso-de-ubicacion</div>,
}));

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  vi.clearAllMocks();
  auth.autenticado = false;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

/** Una página de destino con un botón "atrás" que usa el historial real. */
function Destino({ texto }: { texto: string }) {
  const navigate = useNavigate();
  return (
    <div>
      {texto}
      <button onClick={() => navigate(-1)}>atras</button>
    </div>
  );
}

function renderEn(path: string, previas: string[] = []) {
  return render(
    <MemoryRouter initialEntries={[...previas, path]} initialIndex={previas.length}>
      <Routes>
        <Route path="/map" element={<div>pagina-mapa</div>} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<div>pagina-home</div>} />
        <Route path="/messages" element={<Destino texto="pagina-mensajes" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Los errores de React por actualizar estado durante el render de otro componente. */
function updatesEnRender(): unknown[][] {
  return consoleError.mock.calls.filter(([msg]) =>
    String(msg).includes('Cannot update a component'),
  );
}

describe('LoginPage con sesión ya iniciada', () => {
  it('lleva al returnUrl del mismo origen', async () => {
    auth.autenticado = true;
    renderEn('/login?returnUrl=%2Fmessages');
    expect(await screen.findByText('pagina-mensajes')).toBeInTheDocument();
  });

  it('ignora un returnUrl a otro origen y lleva a /', async () => {
    auth.autenticado = true;
    renderEn('/login?returnUrl=https%3A%2F%2Fevil.example');
    expect(await screen.findByText('pagina-home')).toBeInTheDocument();
  });

  it('no actualiza el router en pleno render', async () => {
    auth.autenticado = true;
    renderEn('/login');
    await screen.findByText('pagina-home');
    expect(updatesEnRender()).toEqual([]);
  });

  it('después de iniciar sesión, "atrás" vuelve a la página anterior al login', async () => {
    // El guard reemplaza /login por el destino en cuanto aparece la sesión, y
    // handleSubmit navega al mismo destino. Si handleSubmit empujaba en vez de
    // reemplazar, el destino quedaba dos veces en el historial y el primer
    // "atrás" no hacía nada visible (medido en el navegador, 2026-10-08).
    mockLogin.mockImplementation(async () => {
      auth.autenticado = true;
    });
    const user = userEvent.setup();
    renderEn('/login?returnUrl=%2Fmessages', ['/map']);

    await user.type(screen.getByLabelText('auth:login.email'), 'ana@example.com');
    await user.type(screen.getByLabelText('auth:login.password'), 'secreto1');
    await user.click(screen.getByRole('button', { name: 'auth:login.submit' }));
    await screen.findByText('pagina-mensajes');

    await user.click(screen.getByRole('button', { name: 'atras' }));
    expect(await screen.findByText('pagina-mapa')).toBeInTheDocument();
  });

  it('sin sesión se queda en el formulario', () => {
    renderEn('/login');
    expect(screen.getByRole('button', { name: 'auth:login.submit' })).toBeInTheDocument();
    expect(screen.queryByText('pagina-home')).not.toBeInTheDocument();
  });
});

describe('RegisterPage con sesión ya iniciada', () => {
  it('lleva a /', async () => {
    auth.autenticado = true;
    renderEn('/register');
    expect(await screen.findByText('pagina-home')).toBeInTheDocument();
  });

  it('no actualiza el router en pleno render', async () => {
    auth.autenticado = true;
    renderEn('/register');
    await screen.findByText('pagina-home');
    expect(updatesEnRender()).toEqual([]);
  });

  it('después del alta muestra el paso de ubicación en vez de irse a /', async () => {
    // El alta deja la sesión abierta, que es justo lo que dispara el guard. La
    // mitad que importa es la segunda: que NO se llegó a la home.
    mockRegister.mockImplementation(async () => {
      auth.autenticado = true;
    });
    const user = userEvent.setup();
    renderEn('/register');

    await user.type(screen.getByLabelText('auth:register.name *'), 'Ana');
    await user.type(screen.getByLabelText('auth:register.email *'), 'ana@example.com');
    await user.type(screen.getByLabelText('auth:register.city *'), 'Montevideo');
    await user.type(screen.getByLabelText('auth:register.password *'), 'secreto1');
    await user.type(screen.getByLabelText('auth:register.confirm *'), 'secreto1');
    await user.click(screen.getByRole('button', { name: 'auth:register.submit' }));

    await waitFor(() => expect(screen.getByText('paso-de-ubicacion')).toBeInTheDocument());
    expect(screen.queryByText('pagina-home')).not.toBeInTheDocument();
  });
});
