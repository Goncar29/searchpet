import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FosterHomeDetailPage } from './FosterHomeDetailPage';
import { ApiError } from '@shared/api/client';

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
