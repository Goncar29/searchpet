import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FosterHomeDetailPage } from './FosterHomeDetailPage';
import { ApiError } from '@shared/api/client';
import { drawnPaths, iconPath, EMOJI } from '../test/icons';

/**
 * ESPEJO DE `mobile/__tests__/foster-home-detail.notFound.test.tsx`.
 *
 * La pantalla es la misma en las dos plataformas y hasta este PR habían
 * divergido: mobile distinguía "no existe" de "no pudimos leerlo" mientras web
 * seguía con `isError || !fosterHome`, que además de no distinguir TAPABA un
 * hogar ya cargado cuando fallaba un refetch.
 */
let mockQuery: Record<string, unknown> = {};
const mockRefetch = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/hooks', () => ({
  useFosterHomeByID: () => mockQuery,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1' } }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useParams: () => ({ id: 'fh-1' }), useNavigate: () => vi.fn() };
});

const hogar = {
  id: 'fh-1',
  owner_user_id: 'u-9',
  city: 'Montevideo',
  photos: [],
  animal_types: [],
};

const sinDatos = (error: unknown) => ({
  data: undefined,
  isLoading: false,
  isError: true,
  error,
  refetch: mockRefetch,
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

beforeEach(() => {
  mockRefetch.mockClear();
  mockQuery = {};
});

describe('FosterHomeDetailPage — 404 no es lo mismo que "no pudimos leerlo"', () => {
  it('un 404 dice que no existe, y NO ofrece reintentar', () => {
    mockQuery = sinDatos(new ApiError('not_found', 404, 'not found'));
    render(<FosterHomeDetailPage />, { wrapper });

    expect(screen.getByText('fosterHomes:detail.notFound')).toBeInTheDocument();
    expect(screen.queryByText('fosterHomes:detail.loadError')).not.toBeInTheDocument();
    expect(screen.queryByText('fosterHomes:detail.retry')).not.toBeInTheDocument();
    // Volver tiene que estar SIEMPRE, o la rama queda sin salida.
    expect(screen.getByText('common:back')).toBeInTheDocument();
  });

  it('un 502 dice que no pudimos leerlo, y SÍ ofrece reintentar', () => {
    mockQuery = sinDatos(new ApiError('server_error', 502, 'bad gateway'));
    render(<FosterHomeDetailPage />, { wrapper });

    expect(screen.getByText('fosterHomes:detail.loadError')).toBeInTheDocument();
    expect(screen.queryByText('fosterHomes:detail.notFound')).not.toBeInTheDocument();
    expect(screen.getByText('fosterHomes:detail.retry')).toBeInTheDocument();
  });

  // `uuid.Parse` corre antes que nada en el backend, así que una URL con un id
  // roto da 400 y no 404. Sin contemplarlo ofrecería reintentar contra una
  // respuesta definitiva.
  it('un 400 por id malformado también dice que no existe', () => {
    mockQuery = sinDatos(new ApiError('invalid_input', 400, 'invalid uuid'));
    render(<FosterHomeDetailPage />, { wrapper });

    expect(screen.getByText('fosterHomes:detail.notFound')).toBeInTheDocument();
    expect(screen.queryByText('fosterHomes:detail.retry')).not.toBeInTheDocument();
  });

  it('un error sin ApiError (red caída) se trata como fallo de lectura', () => {
    mockQuery = sinDatos(new TypeError('Failed to fetch'));
    render(<FosterHomeDetailPage />, { wrapper });

    expect(screen.getByText('fosterHomes:detail.loadError')).toBeInTheDocument();
    expect(screen.queryByText('fosterHomes:detail.notFound')).not.toBeInTheDocument();
  });

  // LA RUTA DE MODERACIÓN: un hogar suspendido tiene que desaparecer aunque
  // esté cacheado.
  it('un 404 en refetch descarta lo cacheado', () => {
    mockQuery = {
      data: hogar,
      isLoading: false,
      isError: true,
      error: new ApiError('not_found', 404, 'not found'),
      refetch: mockRefetch,
    };
    render(<FosterHomeDetailPage />, { wrapper });

    expect(screen.getByText('fosterHomes:detail.notFound')).toBeInTheDocument();
    expect(screen.queryByText(/Montevideo/)).not.toBeInTheDocument();
  });

  // OFFLINE NO ES "NO EXISTE", y es la mentira que quedaba viva.
  //
  // React Query pausa la query sin conexión: `isLoading` false (porque
  // `isFetching` es false), `isError` false, `data` undefined. Sin la rama de
  // `isPaused` eso caía en `!fosterHome` y afirmaba que el hogar no existe.
  it('sin conexión y sin caché dice que estás offline, NO que no existe', () => {
    mockQuery = {
      data: undefined,
      isLoading: false,
      isError: false,
      isPaused: true,
      error: null,
      refetch: mockRefetch,
    };
    render(<FosterHomeDetailPage />, { wrapper });

    expect(screen.getByText('common:offlineTitle')).toBeInTheDocument();
    expect(screen.queryByText('fosterHomes:detail.notFound')).not.toBeInTheDocument();
    expect(screen.queryByText('fosterHomes:detail.loadError')).not.toBeInTheDocument();
    // Volver tiene que seguir estando: sin conexión, sin datos y sin salida
    // sería el peor de los tres estados.
    expect(screen.getByText('common:back')).toBeInTheDocument();
  });

  // La otra mitad, sin la cual bastaría con `isPaused` a secas: con datos
  // cacheados, estar offline NO esconde el hogar. Lo que corresponde ahí es la
  // franja de datos viejos, no un cartel que tape lo que sí tenemos.
  it('sin conexión pero CON caché sigue mostrando el hogar', () => {
    mockQuery = {
      data: hogar,
      isLoading: false,
      isError: false,
      isPaused: true,
      error: null,
      refetch: mockRefetch,
    };
    render(<FosterHomeDetailPage />, { wrapper });

    expect(screen.getByText(/Montevideo/)).toBeInTheDocument();
    expect(screen.queryByText('common:offlineTitle')).not.toBeInTheDocument();
  });

  // EL DEFECTO QUE ESTE PORTE CIERRA: con `isError || !fosterHome`, un refetch
  // fallido tapaba un hogar ya cargado con "no encontrado" — un cartel que
  // miente sobre algo que está en pantalla.
  it('con datos cacheados y un 502 sigue mostrando el hogar', () => {
    mockQuery = {
      data: hogar,
      isLoading: false,
      isError: true,
      error: new ApiError('server_error', 502, 'bad gateway'),
      refetch: mockRefetch,
    };
    render(<FosterHomeDetailPage />, { wrapper });

    expect(screen.getByText(/Montevideo/)).toBeInTheDocument();
    expect(screen.queryByText('fosterHomes:detail.notFound')).not.toBeInTheDocument();
    expect(screen.queryByText('fosterHomes:detail.loadError')).not.toBeInTheDocument();
  });
});

// Emoji rendered as illustrations and button glyphs ignore `currentColor` and
// dark mode. The page draws Material Symbols instead.
describe('FosterHomeDetailPage — sin emoji', () => {
  const conFoto = {
    ...hogar,
    whatsapp_phone: '+59899123456',
    photos: [
      { id: 'p1', url: 'https://cdn/a.jpg' },
      { id: 'p2', url: 'https://cdn/b.jpg' },
    ],
  };

  it('el estado offline dibuja el ícono wifi-off, sin emoji', () => {
    mockQuery = { data: undefined, isLoading: false, isError: false, isPaused: true, error: null, refetch: mockRefetch };
    const { container } = render(<FosterHomeDetailPage />, { wrapper });

    expect(container.textContent).not.toMatch(EMOJI);
    expect(drawnPaths(container)).toContain(iconPath('wifi-off'));
  });

  it('un fallo de lectura dibuja warning y un 404 dibuja home, sin emoji', () => {
    mockQuery = sinDatos(new ApiError('server_error', 502, 'bad gateway'));
    const fallo = render(<FosterHomeDetailPage />, { wrapper });
    expect(fallo.container.textContent).not.toMatch(EMOJI);
    expect(drawnPaths(fallo.container)).toContain(iconPath('warning'));
    expect(drawnPaths(fallo.container)).not.toContain(iconPath('home'));
    fallo.unmount();

    mockQuery = sinDatos(new ApiError('not_found', 404, 'not found'));
    const noExiste = render(<FosterHomeDetailPage />, { wrapper });
    expect(noExiste.container.textContent).not.toMatch(EMOJI);
    expect(drawnPaths(noExiste.container)).toContain(iconPath('home'));
    expect(drawnPaths(noExiste.container)).not.toContain(iconPath('warning'));
  });

  it('sin fotos dibuja el placeholder home y la ciudad con el pin, sin emoji', () => {
    mockQuery = { data: hogar, isLoading: false, isError: false, refetch: mockRefetch };
    const { container } = render(<FosterHomeDetailPage />, { wrapper });

    expect(container.textContent).not.toMatch(EMOJI);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Montevideo');
    expect(drawnPaths(container)).toContain(iconPath('home'));
    expect(drawnPaths(container)).toContain(iconPath('location-on'));
  });

  it('con fotos dibuja el contador con la cámara, y los tres botones de contacto con su ícono', () => {
    mockQuery = { data: conFoto, isLoading: false, isError: false, refetch: mockRefetch };
    const { container } = render(<FosterHomeDetailPage />, { wrapper });

    expect(container.textContent).not.toMatch(EMOJI);
    expect(screen.getByText('1/2')).toBeInTheDocument();
    const paths = drawnPaths(container);
    for (const name of ['photo-camera', 'chat-bubble', 'whatsapp', 'flag'] as const) {
      expect(paths).toContain(iconPath(name));
    }
  });
});
