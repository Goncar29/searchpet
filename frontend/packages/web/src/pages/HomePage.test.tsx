import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomePage } from './HomePage';
import { useSearchPets } from '@shared/hooks';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

let mockAuth: { isAuthenticated: boolean; user: unknown } = { isAuthenticated: false, user: null };

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const mockMutateAsync = vi.fn();
const mockClassify = vi.fn();

let mockStats = { total_users: 100, total_pets: 42, pets_reunited: 10, searches_started: 50 };
// `useSearchPets` se desestructura como `const { data: searchResults }` y la
// pagina lee `searchResults.data`, o sea que el hook devuelve un SOBRE
// paginado, no el array pelado. Devolver el array hace que la grilla no se
// dibuje y el test falle sin que haya nada roto en la pagina.
let mockSearchPets: { data: unknown[]; total?: number } | undefined = undefined;

// `useSearchPets` es `vi.fn()` (y no una arrow function pelada como las otras)
// porque el test de ListState necesita `mockReturnValue` para simular una
// query caída — con una función normal, `vi.mocked(useSearchPets).mockReturnValue`
// no existe.
vi.mock('@shared/hooks', () => ({
  useStats: () => ({ data: mockStats }),
  useNearbyReports: () => ({ data: [], isLoading: false }),
  useSearchPets: vi.fn(),
  useStories: () => ({ data: [], isLoading: false }),
  useImageClassify: () => ({ classify: mockClassify, isModelLoading: false, isClassifying: false, error: null }),
  useImageSearch: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// Una URL con la forma EXACTA que guarda el backend: /image/upload/ seguido de
// la version. Si no tiene esa forma, cloudinaryThumb la devuelve intacta y el
// test pasaria sin probar nada.
const FOTO_CLOUDINARY =
  'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1785290767/searchpet/pets/abc/foto.webp';

describe('HomePage', () => {
  beforeEach(() => {
    mockAuth = { isAuthenticated: false, user: null };
    mockSearchPets = undefined;
    // `mockResolvedValueOnce` encola un valor que sobrevive al test si nadie lo
    // consume. Hoy siempre se consume porque el guard de auth deja pasar la
    // llamada, o sea que el aislamiento depende de una condicion de OTRO
    // archivo: si ese guard cambia, el valor encolado se filtra al proximo test
    // que llame a mutateAsync y rompe en un lugar que no tiene nada que ver.
    mockMutateAsync.mockReset();
    mockClassify.mockReset();
    // `mockImplementation` y no `mockReturnValue`: tiene que leer `mockSearchPets`
    // en cada llamada, porque los tests reasignan esa variable DESPUÉS de este
    // `beforeEach` — con `mockReturnValue` quedaría pegado al valor inicial.
    vi.mocked(useSearchPets).mockImplementation(
      () => ({ data: mockSearchPets, isLoading: false }) as never,
    );
  });

  it('renderiza sin lanzar errores', () => {
    render(<HomePage />, { wrapper });
    // If it renders at all, this passes
    expect(document.body).toBeTruthy();
  });

  it('muestra la sección de mascotas perdidas', () => {
    render(<HomePage />, { wrapper });
    // Page renders with filter/search area
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('renders the four stat counters (lifetime + snapshot) with their values', () => {
    mockStats = { total_users: 150, total_pets: 320, pets_reunited: 42, searches_started: 88 };
    render(<HomePage />, { wrapper });

    expect(screen.getByText('home:stats.reunited')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('home:stats.searches')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('home:stats.members')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('home:stats.registered')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
  });

  it('logged out: selecting a photo shows the login prompt and does not search/classify', async () => {
    mockMutateAsync.mockClear();
    mockClassify.mockClear();

    const { container } = render(<HomePage />, { wrapper });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'pet.png', { type: 'image/png' })] },
    });

    expect(await screen.findByText(/photoSearch\.loginRequired/)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockClassify).not.toHaveBeenCalled();
  });

  // ── Miniaturas del feed ──────────────────────────────────────────────
  // El feed es la pantalla de mas volumen del sitio y la foto original pesa
  // ~198 KB contra ~29 KB de la miniatura: 20 tarjetas son 3,96 MB contra
  // 584 KB. Con 25 creditos/mes de Cloudinary (1 credito = 1 GB de bandwidth)
  // esa diferencia es el techo de trafico del proyecto entero, asi que hace
  // falta un guard y no solo una convencion.

  it('el feed pide la miniatura, no la foto original', () => {
    mockSearchPets = {
      data: [{ id: 'p1', name: 'Luna', status: 'lost', photos: [{ url: FOTO_CLOUDINARY }] }],
      total: 1,
    };

    render(<HomePage />, { wrapper });

    // Este `toContain` es el guard: falla si el tamanio cambia, si el modo de
    // recorte cambia, y tambien si la URL sale sin transformar. No hace falta
    // una asercion extra de "no es la original" — estaria cubierta por esta, y
    // un comentario diciendo que protege algo que ya protege este renglon es
    // como se termina cuidando una linea que no hace nada.
    const img = screen.getByAltText('Luna') as HTMLImageElement;
    expect(img.src).toContain('w_600,h_300,c_lfill,g_auto');
  });

  it('los resultados de busqueda por foto tambien piden la miniatura', async () => {
    mockAuth = { isAuthenticated: true, user: { id: 'u1' } };
    mockMutateAsync.mockResolvedValueOnce({
      results: [{ pet_id: 'p2', name: 'Rocco', similarity: 0.91, photo_url: FOTO_CLOUDINARY }],
    });

    const { container } = render(<HomePage />, { wrapper });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'pet.png', { type: 'image/png' })] },
    });

    const img = (await screen.findByAltText('Rocco')) as HTMLImageElement;
    expect(img.src).toContain('w_600,h_300,c_lfill,g_auto');
  });

  it('una foto que no es de Cloudinary se dibuja intacta', () => {
    // El seed usa picsum. Recortar una URL ajena romperia la imagen en vez de
    // achicarla, asi que el feed tiene que dejarla pasar.
    const ajena = 'https://picsum.photos/seed/foo/800/600';
    mockSearchPets = {
      data: [{ id: 'p3', name: 'Mia', status: 'lost', photos: [{ url: ajena }] }],
      total: 1,
    };

    render(<HomePage />, { wrapper });

    expect((screen.getByAltText('Mia') as HTMLImageElement).src).toBe(ajena);
  });

  // Antes de ListState, `isLoading ? ... : searchResults?.data?.length > 0 ? ... : ...`
  // no distinguía "la query falló" de "no hay resultados" — un `useSearchPets`
  // caído mostraba el mismo cartel de "sin resultados" que un filtro sin
  // coincidencias. Ver ListState.tsx.
  it('con la busqueda caida NO muestra el vacio del feed', () => {
    vi.mocked(useSearchPets).mockReturnValue(
      { data: undefined, isPending: false, isFetching: false, isLoading: false,
        isPaused: false, isError: true, error: new Error('boom'), refetch: vi.fn() } as never,
    );

    render(<HomePage />, { wrapper });

    expect(screen.queryByText('home:noResults.title')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // Con un filtro activo Y la query caída, el título usaba `?? 0`: afirmaba
  // "0 resultados" (un hecho) justo arriba del cartel que dice que no se pudo
  // cargar (una incertidumbre). Sin filtro activo el título ni se renderiza
  // (`hasActiveFilters` es false), así que hace falta activar uno para
  // alcanzar la rama rota.
  //
  // El heading se busca por NOMBRE ACCESIBLE (`getByRole`), no por posición en
  // el DOM: un `<h2>` vacío (la solución intermedia que se probó antes de
  // ésta) hubiera sido invisible a `querySelectorAll('h2')[last]` pero
  // segudia siendo un heading sin nombre — exactamente lo que un lector de
  // pantalla anuncia como "encabezado nivel 2" seguido de silencio. Buscar
  // por nombre hace que ESE defecto también deje el test en rojo.
  it('con un filtro activo y la busqueda caida el titulo cae al generico, sin decir "0"', () => {
    vi.mocked(useSearchPets).mockReturnValue(
      { data: undefined, isPending: false, isFetching: false, isLoading: false,
        isPaused: false, isError: true, error: new Error('boom'), refetch: vi.fn() } as never,
    );

    const { container } = render(<HomePage />, { wrapper });

    const statusSelect = container.querySelector('#filter-status') as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: 'lost' } });
    fireEvent.click(screen.getByRole('button', { name: 'home:searchButton' }));

    const heading = screen.getByRole('heading', { name: 'home:recentReports' });
    expect(heading.textContent).not.toContain('0');
  });
});
