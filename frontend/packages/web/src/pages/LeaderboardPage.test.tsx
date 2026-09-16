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

// La sesion es VARIABLE: la pagina precarga la ciudad del usuario, asi que un
// mock con `user` fijo no distinguiria "precargo" de "no precargo".
let mockUser: { city?: string } | null = null;

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
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
    mockUser = null;
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

  /**
   * La ciudad propia se precarga: el ranking por ciudad no le sirve a nadie si
   * hay que tipear la ciudad de uno mismo para verlo.
   *
   * Las cuatro mitades se testean por separado porque cada una puede romperse
   * sola, y tres de ellas fallarían MOSTRANDO algo plausible.
   */
  describe('precarga de la ciudad del usuario', () => {
    it('con sesion y ciudad, consulta sin que nadie toque nada', () => {
      mockUser = { city: 'Montevideo' };
      render(<LeaderboardPage />, { wrapper });

      expect(lastCity()).toBe('Montevideo');
      // Y el input la muestra: si consultara sin llenarlo, el usuario veria un
      // ranking sin saber de donde salio ni como cambiarlo.
      expect(screen.getByLabelText('leaderboard:cityLabel')).toHaveValue('Montevideo');
      expect(screen.queryByText('leaderboard:enterCity')).toBeNull();
    });

    it('sin sesion NO precarga: sigue pidiendo la ciudad', () => {
      render(<LeaderboardPage />, { wrapper });
      expect(lastCity()).toBe('');
      expect(screen.getByText('leaderboard:enterCity')).toBeTruthy();
    });

    // Las cuentas anteriores a que la ciudad fuera obligatoria en el alta la
    // tienen vacia.
    //
    // OJO CON COMO SE AFIRMA: con ciudad vacia, sembrar y no sembrar producen
    // el MISMO `lastCity()` (''), asi que un test que mire solo eso pasa con la
    // guarda puesta o sacada — lo comprobe en verde. Lo que la guarda cuida de
    // verdad es no QUEMAR la siembra: si sembrara con '', el ref quedaria
    // marcado y la ciudad que llegue despues ya no entraria nunca.
    it('con ciudad vacia no gasta la siembra: la que llega despues si entra', () => {
      mockUser = { city: '   ' };
      const { rerender } = render(<LeaderboardPage />, { wrapper });
      expect(lastCity()).toBe('');
      expect(screen.getByText('leaderboard:enterCity')).toBeTruthy();

      mockUser = { city: 'Paysandu' };
      rerender(<LeaderboardPage />);

      expect(lastCity()).toBe('Paysandu');
    });

    // `AuthContext` arranca con `user` en null y lo hidrata en un efecto, asi
    // que la sesion llega DESPUES del primer render. Con el valor inicial de
    // `useState` esto quedaria en '' para siempre — y la pagina se veria igual
    // de sana que si nunca hubiera habido sesion.
    it('siembra aunque la sesion llegue despues del primer render', () => {
      const { rerender } = render(<LeaderboardPage />, { wrapper });
      expect(lastCity()).toBe('');

      mockUser = { city: 'Salto' };
      rerender(<LeaderboardPage />);

      expect(lastCity()).toBe('Salto');
    });

    // La mitad que protege la ELECCION del usuario contra el default.
    //
    // La ciudad del perfil tiene que CAMBIAR para que esto pruebe algo: las
    // dependencias del efecto son `[user?.city]`, asi que con el mismo valor no
    // vuelve a correr y el test pasaria sin el ref — lo comprobe en verde. El
    // caso real es alguien que edita su ciudad en el perfil, o un `refreshUser`
    // que trae otra, mientras mira el ranking de otra ciudad a proposito.
    it('NO pisa la busqueda del usuario cuando cambia la ciudad de su perfil', () => {
      mockUser = { city: 'Montevideo' };
      const { rerender } = render(<LeaderboardPage />, { wrapper });
      expect(lastCity()).toBe('Montevideo');

      search('Salto');
      expect(lastCity()).toBe('Salto');

      mockUser = { city: 'Rivera' };
      rerender(<LeaderboardPage />);

      expect(lastCity()).toBe('Salto');
      expect(screen.getByLabelText('leaderboard:cityLabel')).toHaveValue('Salto');
    });

    /**
     * EL ORDEN MÁS PROBABLE, y el que la primera versión rompía.
     *
     * `AuthContext` hidrata `user` de forma asíncrona, así que la página se
     * dibuja ANTES de que llegue el perfil: quien entra, ve el pedido de
     * ciudad, tipea la suya y busca, lo hace todo con la sesión todavía en
     * vuelo. Ahí el ref sigue en false, y una guarda que sólo pregunta "¿ya
     * sembré?" deja que el perfil aterrice encima y le pise la búsqueda.
     *
     * La pregunta correcta no es "¿ya sembré?" sino "¿ya está decidida la
     * ciudad?" — y buscar a mano también la decide.
     *
     * El test de arriba no alcanza: busca DESPUÉS de que la siembra ocurrió.
     */
    it('el perfil que llega TARDE no pisa una busqueda ya hecha', () => {
      const { rerender } = render(<LeaderboardPage />, { wrapper });

      search('Salto');
      expect(lastCity()).toBe('Salto');

      // Recién ahora hidrata la sesión.
      mockUser = { city: 'Montevideo' };
      rerender(<LeaderboardPage />);

      expect(lastCity()).toBe('Salto');
      expect(screen.getByLabelText('leaderboard:cityLabel')).toHaveValue('Salto');
    });
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

  // El Avatar lo comparten el podio (h-28 = 112 css) y las filas (h-11 = 44), y
  // el tamanio pedido va por prop porque el visible lo decide una clase de
  // Tailwind. Es exactamente donde se cuela el numero equivocado.
  it('el podio pide 224 y las filas 96', () => {
    const FOTO = 'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1785290767/searchpet/pets/abc/foto.webp';
    entries = [
      entry(1, { profile_photo_url: FOTO }),
      entry(2, { profile_photo_url: FOTO }),
      entry(3, { profile_photo_url: FOTO }),
      entry(4, { profile_photo_url: FOTO }),
    ];

    const { container } = render(<LeaderboardPage />, { wrapper });
    // La pagina no dibuja resultados hasta que se busca una ciudad; sin esto el
    // DOM no tiene un solo <img> y el test pasaria a verde el dia que alguien
    // rompa el avatar.
    search('Montevideo');
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') || '');

    // A CADA plaza por su nombre accesible, no "alguna imagen de 224". La
    // version anterior de este test pedia que EXISTIERA una de 224 y una de 96,
    // y eso queda verde con el 2do y el 3ro pidiendo cualquier cosa — que es
    // exactamente el defecto que se colo (un solo px={224} para dos className
    // distintos). Un guard que no distingue las plazas no protege el podio.
    const avatarDe = (re: RegExp) =>
      (screen.getByLabelText(re).querySelector('img') as HTMLImageElement).getAttribute('src') || '';

    // 1er puesto: h-28 = 112 css -> 224
    expect(avatarDe(/^leaderboard:podiumAria\|1,/)).toContain('w_224,h_224,c_lfill');
    // 2do y 3ro: h-20 = 80 css -> 160
    expect(avatarDe(/^leaderboard:podiumAria\|2,/)).toContain('w_160,h_160,c_lfill');
    expect(avatarDe(/^leaderboard:podiumAria\|3,/)).toContain('w_160,h_160,c_lfill');

    // Las filas (4to en adelante) son h-11 = 44 css -> 96
    expect(srcs.some((s) => s.includes('w_96,h_96,c_lfill'))).toBe(true);

    // Y ninguna se queda con la original.
    expect(srcs.filter((s) => s.includes('res.cloudinary.com')).every((s) => s.includes('c_lfill'))).toBe(true);
  });

  it('el podio NO difiere sus imagenes, las filas si', () => {
    // Tres imagenes siempre arriba del pliegue: diferirlas solo retrasa lo
    // primero que se ve. Las filas nacen abajo y si van diferidas.
    const FOTO = 'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1785290767/searchpet/pets/abc/foto.webp';
    entries = [1, 2, 3, 4].map((r) => entry(r, { profile_photo_url: FOTO }));

    render(<LeaderboardPage />, { wrapper });
    search('Montevideo');

    const podio = screen.getByLabelText(/^leaderboard:podiumAria\|1,/).querySelector('img');
    expect(podio?.getAttribute('loading')).toBeNull();

    const fila = screen.getByLabelText(/^leaderboard:rowAria\|4,/)?.querySelector('img');
    expect(fila?.getAttribute('loading')).toBe('lazy');
  });
});
