// Una historia BORRADA y una historia que no pudimos leer no se pueden contar
// igual.
//
// `apiClient` tira `ApiError` ante cualquier respuesta no-ok (`client.ts`), así
// que un 404 llega a la pantalla como `isError: true` exactamente igual que un
// 502. Ramificar sólo con `isError` le decía a quien buscaba una historia
// borrada "no es que no exista: no llegamos a leerla" —lo contrario de la
// verdad— y le ofrecía un Reintentar que dispara tres pedidos (`retry: 2`) y
// falla siempre.
import React from 'react';
import { render } from '@testing-library/react-native';
import StoryDetailScreen from '../app/story/[id]';
import { ApiError } from '../../shared/api/client';

const mockUseStory = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 's-1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

jest.mock('../../shared/hooks', () => ({
  useStory: (...a: unknown[]) => mockUseStory(...a),
  useLikeStory: () => ({ mutate: jest.fn(), isPending: false }),
  useUnlikeStory: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('../store', () => ({
  useAuthStore: () => ({ isAuthenticated: true }),
}));

const sinDatos = (error: unknown) => ({
  data: undefined,
  isLoading: false,
  isError: true,
  error,
  refetch: jest.fn(),
});

describe('Detalle de historia — 404 no es lo mismo que "no pudimos leerla"', () => {
  it('un 404 dice que no existe, y NO ofrece reintentar', () => {
    mockUseStory.mockReturnValue(sinDatos(new ApiError('not_found', 404, 'not found')));

    const { queryByText } = render(<StoryDetailScreen />);

    expect(queryByText('story:notFound')).toBeTruthy();
    expect(queryByText('story:detailLoadError')).toBeNull();
    // Reintentar contra un 404 dispara tres pedidos y falla siempre: ofrecerlo
    // es prometer algo que no puede pasar.
    expect(queryByText('story:retry')).toBeNull();
    expect(queryByText('story:back')).toBeTruthy();
  });

  it('un fallo de red sí dice que no pudimos leerla, y ofrece reintentar', () => {
    mockUseStory.mockReturnValue(sinDatos(new ApiError('server_error', 502, 'bad gateway')));

    const { queryByText } = render(<StoryDetailScreen />);

    expect(queryByText('story:detailLoadError')).toBeTruthy();
    expect(queryByText('story:notFound')).toBeNull();
    expect(queryByText('story:retry')).toBeTruthy();
    // Volver sigue estando: antes el botón de reintentar lo REEMPLAZABA, así
    // que esa rama se quedaba sin salida dentro de la pantalla.
    expect(queryByText('story:back')).toBeTruthy();
  });

  it('un error sin ApiError (red caída antes de responder) se trata como fallo de lectura', () => {
    // `fetch` puede tirar un `TypeError` sin llegar a tener status. Que ese
    // caso caiga en "no existe" sería la misma mentira al revés.
    mockUseStory.mockReturnValue(sinDatos(new TypeError('Network request failed')));

    const { queryByText } = render(<StoryDetailScreen />);

    expect(queryByText('story:detailLoadError')).toBeTruthy();
    expect(queryByText('story:notFound')).toBeNull();
  });
});
