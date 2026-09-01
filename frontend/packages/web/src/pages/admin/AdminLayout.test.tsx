import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AdminLayout } from './AdminLayout';

// El arnés mockea react-i18next con `t: (key) => key` (igual que el resto de
// las pantallas), así que estas aserciones son sobre CLAVES. Que las claves
// existan traducidas se verifica aparte, en el test de claves — separarlo es
// deliberado: acá una clave faltante no se vería, se pintaría cruda.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function pintar(ruta = '/admin/abuse-reports') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="abuse-reports" element={<p>contenido de denuncias</p>} />
          <Route path="vets" element={<p>contenido de veterinarias</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout', () => {
  it('dibuja las ocho secciones', () => {
    pintar();

    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('link')).toHaveLength(8);
  });

  // Las ocho tienen que estar SIEMPRE en el DOM. La versión anterior las ponía
  // en una fila que envuelve y ésta las mete en una barra lateral; el riesgo
  // del cambio es esconderlas detrás de un breakpoint y dejarlas inalcanzables
  // en el teléfono, que es donde menos lugar hay para adivinar.
  it('ninguna sección queda detrás de un `hidden`', () => {
    pintar();

    const nav = screen.getByRole('navigation');
    expect(nav.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    within(nav)
      .getAllByRole('link')
      .forEach((link) => {
        expect(link.className).not.toMatch(/(^|\s)hidden(\s|$)/);
      });
  });

  // `aria-current` y no sólo el color: la barra activa del diseño es invisible
  // para un lector de pantalla.
  it('marca la sección abierta con aria-current, no sólo con color', () => {
    pintar('/admin/vets');

    const activo = screen.getByRole('link', { current: 'page' });
    expect(activo).toHaveTextContent('nav.vets');
  });

  it('renderiza el contenido de la ruta hija', () => {
    pintar('/admin/vets');

    expect(screen.getByText('contenido de veterinarias')).toBeInTheDocument();
  });

  // El ícono es decoración y la etiqueta ya nombra el destino. Si el svg no
  // fuera `aria-hidden`, un lector leería cada sección dos veces.
  it('los íconos no se anuncian: cada enlace se lee una sola vez', () => {
    pintar();

    const denuncias = screen.getByRole('link', { name: 'nav.abuseReports' });
    const svg = denuncias.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  // El panel conserva su h1 y las pantallas su h2. Promover los ocho <h2> a
  // <h1> habría dejado dos h1 por página, o uno solo si además se borraba éste
  // — y ahí el panel pierde su nombre accesible.
  it('el panel conserva su h1', () => {
    pintar();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('panel.title');
  });
});
