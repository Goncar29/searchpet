// Un hogar DADO DE BAJA y un hogar que no pudimos leer no se pueden contar
// igual.
//
// La pantalla decía `common:noResults` ("sin resultados") en los dos casos, que
// es una afirmación sobre el mundo —"no hay nada"— imposible de sostener cuando
// justamente no llegamos a leerlo. Es el gemelo del arreglo de `story/[id]`, y
// el propio archivo lo tenía anotado como pendiente.
//
// `apiClient` tira `ApiError` ante cualquier respuesta no-ok, así que un 404
// llega como `isError: true` exactamente igual que un 502.
import React from 'react';
import { render } from '@testing-library/react-native';
import FosterHomeDetailScreen from '../app/foster-home/[id]';
import { ApiError } from '../../shared/api/client';

const mockUseFosterHomeByID = jest.fn();
const mockRefetch = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'fh-1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

jest.mock('../../shared/hooks', () => ({
  useFosterHomeByID: (...a: unknown[]) => mockUseFosterHomeByID(...a),
  useSubmitAbuseReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('../store', () => ({
  useAuthStore: () => ({ user: { id: 'u-1' } }),
}));

const sinDatos = (error: unknown) => ({
  data: undefined,
  isLoading: false,
  isError: true,
  error,
  refetch: mockRefetch,
});

beforeEach(() => {
  mockRefetch.mockClear();
});

describe('Detalle de hogar — 404 no es lo mismo que "no pudimos leerlo"', () => {
  it('un 404 dice que no existe, y NO ofrece reintentar', () => {
    mockUseFosterHomeByID.mockReturnValue(
      sinDatos(new ApiError('not_found', 404, 'not found'))
    );

    const { queryByText } = render(<FosterHomeDetailScreen />);

    expect(queryByText('fosterHomes:detail.notFound')).toBeTruthy();
    expect(queryByText('fosterHomes:detail.loadError')).toBeNull();
    // Reintentar contra un 404 es prometer algo que no va a pasar, y encima
    // dispara los reintentos de React Query contra una respuesta definitiva.
    expect(queryByText('fosterHomes:detail.retry')).toBeNull();
    // Pero volver tiene que estar SIEMPRE: sin eso la rama queda sin salida.
    expect(queryByText('fosterHomes:detail.back')).toBeTruthy();
  });

  it('un 502 dice que no pudimos leerlo, y SÍ ofrece reintentar', () => {
    mockUseFosterHomeByID.mockReturnValue(
      sinDatos(new ApiError('server_error', 502, 'bad gateway'))
    );

    const { queryByText } = render(<FosterHomeDetailScreen />);

    expect(queryByText('fosterHomes:detail.loadError')).toBeTruthy();
    expect(queryByText('fosterHomes:detail.notFound')).toBeNull();
    expect(queryByText('fosterHomes:detail.retry')).toBeTruthy();
    expect(queryByText('fosterHomes:detail.back')).toBeTruthy();
  });

  // La tercera rama, que es la que existía antes y no hay que perder: sin error
  // y sin datos, el hogar simplemente no está. Ahí `notFound` es verdad.
  it('sin error y sin datos dice que no existe', () => {
    mockUseFosterHomeByID.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    const { queryByText } = render(<FosterHomeDetailScreen />);

    expect(queryByText('fosterHomes:detail.notFound')).toBeTruthy();
    expect(queryByText('fosterHomes:detail.retry')).toBeNull();
  });

  // Y la que motivó el arreglo hermano: React Query CONSERVA lo cacheado cuando
  // falla un refetch, así que con datos en mano no se pinta ningún cartel — el
  // hogar existe y se está mirando.
  it('con datos cacheados y un refetch fallido NO muestra ningún cartel', () => {
    mockUseFosterHomeByID.mockReturnValue({
      data: {
        id: 'fh-1',
        owner_user_id: 'u-9',
        title: 'Casa de Ana',
        photos: [],
        animal_types: [],
      },
      isLoading: false,
      isError: true,
      error: new ApiError('server_error', 502, 'bad gateway'),
      refetch: mockRefetch,
    });

    const { queryByText } = render(<FosterHomeDetailScreen />);

    expect(queryByText('fosterHomes:detail.notFound')).toBeNull();
    expect(queryByText('fosterHomes:detail.loadError')).toBeNull();
  });
});
