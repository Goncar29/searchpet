import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SheltersPage } from './SheltersPage';

// El mock interpola: devuelve `clave|valores`. Con `t: (key) => key` a secas,
// los nombres accesibles de las tarjetas salían todos idénticos en el test aun
// pasándoles el refugio — o sea que el test no podía distinguir "paso el nombre"
// de "me olvidé el objeto de interpolación", que es justo el defecto que estas
// etiquetas existen para evitar.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

// Mutable so each test can inject its own shelter list / ownership state.
let sheltersData: unknown[] = [];
let myShelterData: unknown = undefined;
// Records every city argument the page hands to `useShelters`, in order. The
// draft/applied split is only observable from here: the input's value changing
// is NOT evidence that the query stayed put.
const sheltersCalls: (string | undefined)[] = [];
vi.mock('@shared/hooks', () => ({
  useStats: () => ({ data: { total_pets: 10, total_found: 5, total_users: 20, total_reports: 30 } }),
  useShelters: (city?: string) => {
    sheltersCalls.push(city);
    return { data: sheltersData, isLoading: false, isError: false };
  },
  useMyShelter: () => ({ data: myShelterData, isLoading: false, error: null }),
}));

const longDescription =
  'Organización sin fines de lucro dedicada al rescate, rehabilitación y adopción responsable de perros y gatos en situación de calle. Trabajan a diario en operaciones de rescate y actividades comunitarias para las mascotas más vulnerables.';

const shelterWithDescription = {
  id: 's1',
  name: 'Refugio Grande',
  city: 'Montevideo',
  phone: '099123456',
  email: 'info@refugio.org',
  website_url: 'https://refugio.org',
  donation_url: 'https://refugio.org/donar',
  description: longDescription,
  is_verified: true,
  created_at: '2026-07-12T00:00:00Z',
};

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** The city the page most recently asked the API for. */
const lastCity = () => sheltersCalls[sheltersCalls.length - 1];

describe('SheltersPage', () => {
  beforeEach(() => {
    sheltersData = [];
    myShelterData = undefined;
    sheltersCalls.length = 0;
  });

  it('renderiza sin lanzar errores', () => {
    render(<SheltersPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('muestra mensaje vacío cuando no hay refugios', () => {
    render(<SheltersPage />, { wrapper });
    expect(screen.getByText('shelters:empty')).toBeTruthy();
  });

  it('muestra el CTA de registro (sin refugio) apuntando a /shelters/register', () => {
    render(<SheltersPage />, { wrapper });
    const cta = screen.getByText('shelters:registerButton');
    expect(cta.closest('a')?.getAttribute('href')).toBe('/shelters/register');
    expect(screen.getByText('shelters:registerCta')).toBeTruthy();
    expect(screen.queryByText('shelters:contactCta')).toBeNull();
  });

  it('si el usuario ya tiene refugio, el CTA pasa a "gestionar" apuntando a /shelters/mine', () => {
    myShelterData = { id: 'mine-1', name: 'Mi Refugio', city: 'Montevideo', status: 'approved' };
    render(<SheltersPage />, { wrapper });

    const manage = screen.getByText('shelters:manageButton');
    expect(manage.closest('a')?.getAttribute('href')).toBe('/shelters/mine');
    // Ya no invita a registrarse.
    expect(screen.queryByText('shelters:registerButton')).toBeNull();
    expect(screen.queryByText('shelters:registerCta')).toBeNull();
  });

  it('recorta la descripción con line-clamp y ofrece "Ver más"', () => {
    sheltersData = [shelterWithDescription];
    render(<SheltersPage />, { wrapper });

    const desc = screen.getByText(longDescription);
    expect(desc.className).toContain('line-clamp-3');
    expect(screen.getByText('shelters:seeMore')).toBeTruthy();
    // Sin abrir, no hay modal.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('abre un modal con la info completa al tocar "Ver más" y lo cierra', () => {
    sheltersData = [shelterWithDescription];
    render(<SheltersPage />, { wrapper });

    fireEvent.click(screen.getByText('shelters:seeMore'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Refugio Grande')).toBeTruthy();
    expect(within(dialog).getByText(longDescription)).toBeTruthy();
    // La descripción en el modal NO está recortada.
    expect(within(dialog).getByText(longDescription).className).not.toContain('line-clamp-3');

    fireEvent.click(within(dialog).getByText('shelters:close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no muestra "Ver más" en refugios sin descripción', () => {
    sheltersData = [{ ...shelterWithDescription, description: undefined }];
    render(<SheltersPage />, { wrapper });
    expect(screen.queryByText('shelters:seeMore')).toBeNull();
  });

  it('da a cada tarjeta controles con nombre accesible propio', () => {
    // Seis "Donar" que se anuncian igual no le dicen a nadie a qué refugio van,
    // y el <article> que los envuelve NO cuenta como contexto para WCAG 2.4.4.
    sheltersData = [
      shelterWithDescription,
      { ...shelterWithDescription, id: 's2', name: 'Refugio Nuevo' },
    ];
    render(<SheltersPage />, { wrapper });

    for (const key of ['shelters:donateAria', 'shelters:visitWebAria', 'shelters:seeMoreAria']) {
      const names = screen
        .getAllByLabelText(new RegExp(`^${key}\\|`))
        .map((el) => el.getAttribute('aria-label'));
      expect(names).toHaveLength(2);
      expect(new Set(names).size).toBe(2);
    }
  });

  describe('modal: teclado y foco', () => {
    const openDetail = () => {
      sheltersData = [shelterWithDescription];
      render(<SheltersPage />, { wrapper });
      const trigger = screen.getByText('shelters:seeMore').closest('button')!;
      fireEvent.click(trigger);
      return trigger;
    };

    it('mueve el foco adentro al abrir', () => {
      openDetail();
      const dialog = screen.getByRole('dialog');
      // Sin esto el foco queda en el botón que el propio modal acaba de tapar.
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('cierra con Escape', () => {
      openDetail();
      expect(screen.getByRole('dialog')).toBeTruthy();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('devuelve el foco a quien lo abrió', () => {
      const trigger = openDetail();
      fireEvent.keyDown(document, { key: 'Escape' });
      // Devolverlo al <body> obliga a retabular la página desde cero.
      expect(document.activeElement).toBe(trigger);
    });

    it('el diálogo se anuncia con el nombre del refugio', () => {
      openDetail();
      const dialog = screen.getByRole('dialog');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy!)?.textContent).toBe('Refugio Grande');
    });
  });

  it('marca como verificados solo a los refugios que lo son', () => {
    sheltersData = [
      shelterWithDescription,
      { ...shelterWithDescription, id: 's2', name: 'Refugio Nuevo', is_verified: false },
    ];
    render(<SheltersPage />, { wrapper });

    // Dos tarjetas, un solo distintivo.
    expect(screen.getAllByText('shelters:verified')).toHaveLength(1);
  });

  describe('búsqueda por ciudad', () => {
    it('no consulta la API mientras se tipea: solo al enviar', () => {
      render(<SheltersPage />, { wrapper });
      expect(lastCity()).toBeUndefined();

      const input = screen.getByLabelText('shelters:cityLabel');
      fireEvent.change(input, { target: { value: 'Salt' } });
      fireEvent.change(input, { target: { value: 'Salto' } });

      // Tres letras tipeadas no son tres consultas: el borrador no viaja.
      expect(lastCity()).toBeUndefined();

      fireEvent.click(screen.getByText('shelters:searchButton'));
      expect(lastCity()).toBe('Salto');
    });

    it('recorta los espacios y trata el campo vacío como "sin filtro"', () => {
      render(<SheltersPage />, { wrapper });
      const input = screen.getByLabelText('shelters:cityLabel');

      fireEvent.change(input, { target: { value: '  Salto  ' } });
      fireEvent.click(screen.getByText('shelters:searchButton'));
      expect(lastCity()).toBe('Salto');

      // Un campo en blanco no puede filtrar por la cadena vacía: eso pediría
      // `?city=` y el backend lo trataría como un filtro que no matchea nada.
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.click(screen.getByText('shelters:searchButton'));
      expect(lastCity()).toBeUndefined();
    });

    it('sin resultados por ciudad muestra un vacío propio, no el del directorio', () => {
      render(<SheltersPage />, { wrapper });

      fireEvent.change(screen.getByLabelText('shelters:cityLabel'), {
        target: { value: 'Salto' },
      });
      fireEvent.click(screen.getByText('shelters:searchButton'));

      // "No hay refugios disponibles" sería falso: los hay, pero no en Salto.
      // Y la ciudad tiene que viajar hasta el mensaje, o vuelve a ser genérico.
      expect(screen.getByText('shelters:emptyForCity|Salto')).toBeTruthy();
      expect(screen.queryByText('shelters:empty')).toBeNull();
    });

    it('ofrece una salida del filtro AUNQUE la búsqueda haya dado resultados', () => {
      // Estaba solo en el estado vacío: quien buscaba y encontraba se quedaba
      // sin forma de volver al directorio completo.
      sheltersData = [shelterWithDescription];
      render(<SheltersPage />, { wrapper });

      fireEvent.change(screen.getByLabelText('shelters:cityLabel'), {
        target: { value: 'Montevideo' },
      });
      fireEvent.click(screen.getByText('shelters:searchButton'));
      expect(lastCity()).toBe('Montevideo');
      expect(screen.getByText('shelters:clearFilter')).toBeTruthy();
    });

    it('la salida quita el filtro y limpia el campo', () => {
      render(<SheltersPage />, { wrapper });

      const input = screen.getByLabelText('shelters:cityLabel');
      fireEvent.change(input, { target: { value: 'Salto' } });
      fireEvent.click(screen.getByText('shelters:searchButton'));
      expect(lastCity()).toBe('Salto');

      fireEvent.click(screen.getByText('shelters:clearFilter'));

      // Vuelve el directorio completo y el campo queda limpio, o el usuario
      // veria la ciudad tipeada sin que siga aplicada.
      expect(lastCity()).toBeUndefined();
      expect((input as HTMLInputElement).value).toBe('');
      expect(screen.getByText('shelters:empty')).toBeTruthy();
    });
  });
});
