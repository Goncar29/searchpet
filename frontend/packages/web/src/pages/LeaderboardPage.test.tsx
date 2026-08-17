import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeaderboardPage } from './LeaderboardPage';

// El mock interpola: devuelve `clave|valores`. Con `t: (key) => key` a secas
// los nombres accesibles de las filas salen todos idénticos aunque el
// componente pase el nombre de la persona, y el test no distingue "paso el
// dato" de "me olvidé el objeto de interpolación" — que es justo el defecto que
// estas etiquetas existen para evitar (lección del PR #162).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

let entries: unknown[] = [];
let isLoading = false;
let error: unknown = null;
/** Cada ciudad que la página le pidió al hook, en orden. */
const cityCalls: string[] = [];

vi.mock('@shared/hooks', () => ({
  useLeaderboard: (city: string) => {
    cityCalls.push(city);
    return { data: entries, isLoading, error };
  },
  useStats: () => ({ data: { pets_reunited: 128, total_users: 940 } }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const entry = (rank: number, over: Record<string, unknown> = {}) => ({
  user_id: `u${rank}`,
  name: `Persona ${rank}`,
  city: 'Montevideo',
  total_points: 100 - rank,
  rank,
  badges: [],
  ...over,
});

/** La última ciudad que la página pidió. */
const lastCity = () => cityCalls[cityCalls.length - 1];

/** Busca la ciudad y devuelve el input, para no repetirlo en cada test. */
function search(city: string) {
  fireEvent.change(screen.getByLabelText('leaderboard:cityLabel'), { target: { value: city } });
  fireEvent.click(screen.getByText('leaderboard:searchButton'));
}

describe('LeaderboardPage', () => {
  beforeEach(() => {
    entries = [];
    isLoading = false;
    error = null;
    cityCalls.length = 0;
  });

  it('renderiza sin lanzar errores', () => {
    render(<LeaderboardPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('sin ciudad no consulta y pide una', () => {
    render(<LeaderboardPage />, { wrapper });
    expect(lastCity()).toBe('');
    expect(screen.getByText('leaderboard:enterCity')).toBeTruthy();
  });

  it('no consulta mientras se tipea: solo al enviar', () => {
    render(<LeaderboardPage />, { wrapper });

    const input = screen.getByLabelText('leaderboard:cityLabel');
    fireEvent.change(input, { target: { value: 'Monte' } });
    fireEvent.change(input, { target: { value: 'Montevideo' } });
    expect(lastCity()).toBe('');

    fireEvent.click(screen.getByText('leaderboard:searchButton'));
    expect(lastCity()).toBe('Montevideo');
  });

  it('recorta los espacios de la ciudad', () => {
    render(<LeaderboardPage />, { wrapper });
    search('  Montevideo  ');
    expect(lastCity()).toBe('Montevideo');
  });

  describe('podio', () => {
    beforeEach(() => {
      entries = [entry(1), entry(2), entry(3), entry(4), entry(5)];
    });

    it('pone a los tres primeros en el podio y al resto en la lista', () => {
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      // El podio usa `podiumAria`; las filas usan `rowAria`. Tres y dos.
      expect(screen.getAllByLabelText(/^leaderboard:podiumAria\|/)).toHaveLength(3);
      expect(screen.getAllByLabelText(/^leaderboard:rowAria\|/)).toHaveLength(2);
    });

    it('el DOM lee 1-2-3 aunque el podio se vea 2-1-3', () => {
      // El orden visual lo hace `order-first sm:order-none`, no el DOM: el
      // teclado y un lector de pantalla tienen que recorrer el podio del
      // primero al tercero, no empezando por el segundo.
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const places = screen
        .getAllByLabelText(/^leaderboard:podiumAria\|/)
        .map((el) => el.getAttribute('aria-label')!.split('|')[1].split(',')[0]);
      expect(places).toEqual(['1', '2', '3']);
    });

    it('cada control se anuncia con la persona, no todos igual', () => {
      // Veinte links que dicen lo mismo no le sirven a nadie (WCAG 2.4.4).
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const names = [
        ...screen.getAllByLabelText(/^leaderboard:podiumAria\|/),
        ...screen.getAllByLabelText(/^leaderboard:rowAria\|/),
      ].map((el) => el.getAttribute('aria-label'));
      expect(new Set(names).size).toBe(5);
    });
  });

  describe('logros', () => {
    const SEIS = [
      'first_helper',
      'pet_rescuer',
      'social_butterfly',
      'verified_finder',
      'community_guardian',
      'super_finder',
    ];

    it('una fila muestra 3 logros y resume el resto en "+N"', () => {
      entries = [entry(1), entry(2), entry(3), entry(4, { badges: SEIS })];
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const row = screen.getByLabelText(/^leaderboard:rowAria\|/);
      // Seis posibles por veinte filas rompe la grilla en celular: van 3 y un
      // resumen que dice de qué es. Se cuentan por su etiqueta y no con
      // `getAllByRole('img')` a secas, porque el resumen también es `img` — y
      // tiene que serlo: `aria-label` en un elemento genérico no se expone.
      expect(within(row).getAllByLabelText(/^badges:/)).toHaveLength(3);
      expect(within(row).getByText('+3')).toBeTruthy();
      const resumen = within(row).getByLabelText('leaderboard:moreBadges|3');
      expect(resumen.getAttribute('role')).toBe('img');
    });

    it('sin excedente no aparece ningún "+N"', () => {
      entries = [entry(1), entry(2), entry(3), entry(4, { badges: SEIS.slice(0, 3) })];
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const row = screen.getByLabelText(/^leaderboard:rowAria\|/);
      expect(within(row).getAllByLabelText(/^badges:/)).toHaveLength(3);
      expect(within(row).queryByText(/^\+/)).toBeNull();
    });

    it('el podio los muestra TODOS: ahí el ancho da', () => {
      entries = [entry(1, { badges: SEIS }), entry(2), entry(3)];
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const first = screen.getByLabelText(/^leaderboard:podiumAria\|1,/);
      expect(within(first).getAllByRole('img')).toHaveLength(6);
    });

    it('el nombre accesible del link dice CUÁNTOS logros tiene', () => {
      // Un `aria-label` explícito en un link reemplaza el nombre que se
      // computaría de su contenido, así que los `role="img"` de adentro no
      // entran en él: quien tabula oía sólo "Puesto 4: Persona 4, 148 pts".
      // Va el conteo y no los seis nombres — tabular veinte filas escuchando
      // seis logros cada una es peor que no tenerlos.
      entries = [entry(1), entry(2), entry(3), entry(4, { badges: SEIS })];
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const row = screen.getByLabelText(/^leaderboard:rowAria\|/);
      expect(row.getAttribute('aria-label')).toContain('leaderboard:badgeCount|6');
    });

    it('sin logros, el nombre accesible no menciona ninguno', () => {
      entries = [entry(1), entry(2), entry(3), entry(4, { badges: [] })];
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const row = screen.getByLabelText(/^leaderboard:rowAria\|/);
      // Ni un "0 logros" colgando del final.
      expect(row.getAttribute('aria-label')).not.toContain('badgeCount');
    });

    it('cada logro se anuncia con su nombre, no con el emoji', () => {
      // Un emoji suelto lo lee un lector de pantalla por su nombre Unicode
      // ("handshake"), que no le dice nada a nadie. El `title` tampoco alcanza:
      // en touch no hay hover.
      entries = [entry(1, { badges: ['first_helper'] }), entry(2), entry(3)];
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      expect(screen.getAllByLabelText('badges:first_helper.label').length).toBeGreaterThan(0);
    });

    it('ignora un tipo de logro desconocido en vez de romper', () => {
      entries = [entry(1), entry(2), entry(3), entry(4, { badges: ['no_existe'] })];
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const row = screen.getByLabelText(/^leaderboard:rowAria\|/);
      expect(within(row).queryAllByRole('img')).toHaveLength(0);
    });
  });

  describe('avatar', () => {
    it('usa la foto cuando la hay', () => {
      entries = [entry(1, { profile_photo_url: 'https://cdn.test/a.webp' }), entry(2), entry(3)];
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const img = screen.getByLabelText(/^leaderboard:podiumAria\|1,/).querySelector('img');
      expect(img?.getAttribute('src')).toBe('https://cdn.test/a.webp');
      // alt vacío: el link ya se anuncia con el nombre, y repetirlo lo diría dos veces.
      expect(img?.getAttribute('alt')).toBe('');
    });

    it('cae en la inicial cuando no hay foto', () => {
      entries = [entry(1, { name: 'Zulema' }), entry(2), entry(3)];
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      const place = screen.getByLabelText(/^leaderboard:podiumAria\|1,/);
      expect(place.querySelector('img')).toBeNull();
      expect(within(place).getByText('Z')).toBeTruthy();
    });
  });

  describe('estados', () => {
    it('cargando muestra el esqueleto y ningún puesto', () => {
      isLoading = true;
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
      expect(screen.queryByLabelText(/^leaderboard:podiumAria\|/)).toBeNull();
    });

    it('el error no se confunde con "no hay nadie"', () => {
      error = new Error('boom');
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      expect(screen.getByText('leaderboard:loadError')).toBeTruthy();
      expect(screen.queryByText(/^leaderboard:empty\|/)).toBeNull();
    });

    it('un fallo de refetch NO borra un ranking ya dibujado', () => {
      // React Query conserva los datos cacheados cuando falla un refetch, y
      // ahí `isLoading` es false. Con la guarda anterior (`!error`), el cold
      // start de Render tras dormirse reemplazaba un ranking entero por el
      // cartel de error. Mostrar datos viejos es mejor que borrar los que hay.
      entries = [entry(1), entry(2), entry(3), entry(4)];
      error = new Error('502 del cold start');
      render(<LeaderboardPage />, { wrapper });
      search('Montevideo');

      expect(screen.getAllByLabelText(/^leaderboard:podiumAria\|/)).toHaveLength(3);
      expect(screen.queryByText('leaderboard:loadError')).toBeNull();
    });

    it('sin gente en la ciudad lo dice con la ciudad adentro', () => {
      render(<LeaderboardPage />, { wrapper });
      search('Salto');
      expect(screen.getByText('leaderboard:empty|Salto')).toBeTruthy();
    });
  });
});
