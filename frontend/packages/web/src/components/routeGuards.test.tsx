import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router';
import { ProtectedRoute } from './ProtectedRoute';
import { AdminRoute } from './AdminRoute';

/**
 * Los dos guards que deciden quién entra a las páginas privadas y al panel
 * admin. No tenían ningún test: una regresión acá dejaba entrar a quien no
 * debía, o echaba a quien sí, sin que nada se pusiera rojo.
 *
 * Con el router REAL y mirando a qué ruta se llega, por lo mismo que
 * pages/authRedirect.test.tsx: los dos redirigen con <Navigate>, que no pasa
 * por un useNavigate mockeado.
 */

const auth = vi.hoisted(() => ({ isAuthenticated: false, isAdmin: false, isLoading: false }));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => auth,
}));

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.isAdmin = false;
  auth.isLoading = false;
});

/** La página de login de mentira: muestra a dónde la mandaron volver. */
function LoginProbe() {
  const [params] = useSearchParams();
  return <div>login returnUrl={String(params.get('returnUrl'))}</div>;
}

function renderEn(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/" element={<div>pagina-home</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/reports/create" element={<div>pagina-privada</div>} />
        </Route>
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<div>pagina-admin</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('con sesión muestra la página', () => {
    auth.isAuthenticated = true;
    renderEn('/reports/create');
    expect(screen.getByText('pagina-privada')).toBeInTheDocument();
  });

  it('sin sesión manda al login con el path para volver', () => {
    renderEn('/reports/create');
    expect(screen.getByText('login returnUrl=/reports/create')).toBeInTheDocument();
    expect(screen.queryByText('pagina-privada')).not.toBeInTheDocument();
  });

  it('sin sesión conserva los query params en el returnUrl', () => {
    // El detalle de mascota enlaza a /reports/create?petId=…; sin el query, el
    // usuario vuelve del login al formulario sin la mascota elegida. Los dos
    // parámetros prueban además que el returnUrl va codificado: sin codificar,
    // el `&` cortaría el returnUrl y `status` quedaría como parámetro del login.
    renderEn('/reports/create?petId=123&status=found');
    expect(
      screen.getByText('login returnUrl=/reports/create?petId=123&status=found'),
    ).toBeInTheDocument();
  });

  it('mientras carga la sesión no muestra la página ni redirige', () => {
    auth.isLoading = true;
    renderEn('/reports/create');
    expect(screen.queryByText('pagina-privada')).not.toBeInTheDocument();
    expect(screen.queryByText(/^login/)).not.toBeInTheDocument();
  });
});

describe('AdminRoute', () => {
  it('un admin ve el panel', () => {
    auth.isAuthenticated = true;
    auth.isAdmin = true;
    renderEn('/admin');
    expect(screen.getByText('pagina-admin')).toBeInTheDocument();
  });

  it('un usuario con sesión pero sin admin va a la home', () => {
    auth.isAuthenticated = true;
    renderEn('/admin');
    expect(screen.getByText('pagina-home')).toBeInTheDocument();
    expect(screen.queryByText('pagina-admin')).not.toBeInTheDocument();
  });

  it('sin sesión manda al login con el path y el query para volver', () => {
    // Antes mandaba a /login a secas: un admin con la sesión vencida volvía a
    // la home en vez de a la sección del panel que estaba abriendo.
    renderEn('/admin?pagina=2&orden=fecha');
    expect(screen.getByText('login returnUrl=/admin?pagina=2&orden=fecha')).toBeInTheDocument();
    expect(screen.queryByText('pagina-admin')).not.toBeInTheDocument();
  });

  it('mientras carga la sesión no muestra el panel ni redirige', () => {
    auth.isLoading = true;
    auth.isAuthenticated = true;
    auth.isAdmin = true;
    renderEn('/admin');
    expect(screen.queryByText('pagina-admin')).not.toBeInTheDocument();
    expect(screen.queryByText('pagina-home')).not.toBeInTheDocument();
    expect(screen.queryByText(/^login/)).not.toBeInTheDocument();
  });
});
