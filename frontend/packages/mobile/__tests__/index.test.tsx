// Home/Feed screen smoke test — feed unificado vía useSearchPets (como web)
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import HomeScreen from '../app/(tabs)/index';

// t identity — permite presionar chips por su key i18n en los tests de interacción
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('i18next', () => ({
  t: (key: string) => key,
}));

// expo-router is mocked in jest.setup.js

jest.mock('../store', () => ({
  useAuthStore: (selector) => {
    const state = {
      login: jest.fn(),
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// El feed SIEMPRE sale de useSearchPets (lost+stray por defecto, sin radio)
const mockUseSearchPets = jest.fn(() => ({
  data: { data: [{ id: 'pet-1', name: 'Firulais', status: 'lost' }], total: 1 },
  isLoading: false,
  isRefetching: false,
  refetch: jest.fn(),
}));

jest.mock('@shared/hooks', () => ({
  useSearchPets: (params) => mockUseSearchPets(params),
  useStories: () => ({ data: [], isLoading: false }),
  useImageClassify: () => ({ classify: jest.fn(), isModelLoading: false, isClassifying: false, error: null }),
  useImageSearchNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// expo-location is mocked via moduleNameMapper → __mocks__/expo-location.js

const mockPetCardRender = jest.fn();
jest.mock('../components/PetCard', () => ({
  PetCard: (props) => {
    mockPetCardRender(props);
    return null;
  },
}));

describe('HomeScreen (Feed)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renderiza sin lanzar errores', () => {
    const { toJSON } = render(<HomeScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('usa useSearchPets como fuente del feed, sin filtro de distancia por defecto', () => {
    render(<HomeScreen />);
    expect(mockUseSearchPets).toHaveBeenCalled();
    const params = mockUseSearchPets.mock.calls[0][0];
    expect(params.lat).toBeUndefined();
    expect(params.lng).toBeUndefined();
    expect(params.radiusMeters).toBeUndefined();
  });

  it('renderiza cada resultado del feed con la variante pet de PetCard', () => {
    render(<HomeScreen />);
    expect(mockPetCardRender).toHaveBeenCalledWith(
      expect.objectContaining({ pet: expect.objectContaining({ id: 'pet-1' }) })
    );
  });

  it('aplicar un radio agrega lat/lng/radiusMeters a la búsqueda; re-tap lo quita', () => {
    const { getByText } = render(<HomeScreen />);

    // Abrir la sección de filtros extra y elegir 5 km
    fireEvent.press(getByText(/home:more/));
    fireEvent.press(getByText('5 km'));

    let params = mockUseSearchPets.mock.calls.at(-1)[0];
    expect(params.radiusMeters).toBe(5000);
    expect(params.lat).toBe(-34.9011);
    expect(params.lng).toBe(-56.1645);

    // Tap sobre el chip activo → deselecciona el filtro de distancia
    fireEvent.press(getByText('5 km'));
    params = mockUseSearchPets.mock.calls.at(-1)[0];
    expect(params.radiusMeters).toBeUndefined();
    expect(params.lat).toBeUndefined();
    expect(params.lng).toBeUndefined();
  });

  it('limpiar filtros resetea también el radio', () => {
    const { getByText } = render(<HomeScreen />);

    fireEvent.press(getByText(/home:more/));
    fireEvent.press(getByText('10 km'));
    expect(mockUseSearchPets.mock.calls.at(-1)[0].radiusMeters).toBe(10000);

    // Con radio activo el header pasa a modo resultados y ofrece limpiar
    fireEvent.press(getByText(/home:clearFilters/));
    const params = mockUseSearchPets.mock.calls.at(-1)[0];
    expect(params.radiusMeters).toBeUndefined();
  });
});
