// Pet Detail screen smoke test
import React from 'react';
import { render } from '@testing-library/react-native';
import PetDetailScreen from '../app/pet/[id]';

// expo-router setup: useLocalSearchParams returns { id: 'pet-123' }
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'pet-123' }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));

jest.mock('../store', () => ({
  useAuthStore: (selector) => {
    const state = {
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      login: jest.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: () => ({ latitude: null, longitude: null, setLocation: jest.fn() }),
}));

const mockUsePetByID = jest.fn();
const mockUseReportsByPetID = jest.fn();

jest.mock('@shared/hooks', () => ({
  usePetByID: (...args: unknown[]) => mockUsePetByID(...args),
  useReportsByPetID: () => mockUseReportsByPetID(),
  useMarkPetAsFound: () => ({ mutate: jest.fn(), isPending: false }),
  useBlockUser: () => ({ mutate: jest.fn(), isPending: false }),
  useSubmitAbuseReport: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@shared/utils/whatsappTemplates', () => ({
  buildWhatsAppContactURL: () => 'https://wa.me/',
}));

jest.mock('../components/ShareButton', () => ({
  ShareButton: () => null,
}));

jest.mock('../components/PdfFlyerButton', () => ({
  PdfFlyerButton: () => null,
}));

jest.mock('../components/TimelineMap', () => ({
  TimelineMap: () => null,
}));

const mockPetBase = {
  id: 'pet-123',
  name: 'Firulais',
  type: 'perro',
  breed: 'Labrador',
  color: 'negro',
  description: 'Un perro muy bueno',
  owner_id: 'owner-1',
  photos: [],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  mockUsePetByID.mockReturnValue({ data: null, isLoading: true });
  mockUseReportsByPetID.mockReturnValue({ data: [] });
});

// El historial de avistamientos es lo que dice DONDE se vio a la mascota. Con
// `reports ?? []` una consulta caida dibujaba el mapa vacio, o sea "nadie la
// vio" — y esa es la pregunta entera de la pantalla en una app para encontrar
// mascotas perdidas.
//
// `errorTitle` nombra la SECCION y no la causa. El titulo por defecto dice "no
// pudimos cargar esta lista", que en las pantallas donde la lista ES la pagina
// se entiende solo; aca el cartel aterriza en medio de un detalle donde la foto,
// los datos y el contacto cargaron bien, asi que sin nombrar el historial el
// usuario no sabe a que se refiere. Mismo criterio que la web (PR #190).
describe('PetDetailScreen — el historial no pudo cargar', () => {
  const petVisible = {
    ...mockPetBase,
    status: 'lost',
    owner: { id: 'owner-1', name: 'Ana', phone: '099', is_verified: false },
  };

  it('avisa que fallo el historial, nombrando la seccion', () => {
    mockUsePetByID.mockReturnValue({ data: petVisible, isLoading: false });
    mockUseReportsByPetID.mockReturnValue({ data: undefined, isError: true });
    const { getByText, queryByText } = render(<PetDetailScreen />);

    expect(getByText('pets:detail.timelineLoadError')).toBeTruthy();
    // El titulo generico NO: no nombra que seccion fallo.
    expect(queryByText('common:loadErrorTitle')).toBeNull();
  });

  // La mitad positiva. Un historial genuinamente vacio —una mascota registrada
  // que nadie reporto todavia— no puede disparar el cartel: ahi SI preguntamos y
  // la respuesta fue "ninguno". Sin este test, un guard escrito de mas pondria
  // "no pudimos cargar" sobre cada mascota sin avistamientos.
  it('un historial vacio de verdad no dispara ningun cartel', () => {
    mockUsePetByID.mockReturnValue({ data: petVisible, isLoading: false });
    mockUseReportsByPetID.mockReturnValue({ data: [] });
    const { queryByText } = render(<PetDetailScreen />);

    expect(queryByText('pets:detail.timelineLoadError')).toBeNull();
    expect(queryByText('common:loadErrorTitle')).toBeNull();
  });

  // El resto de la pantalla NO se cae con el historial: la foto, los datos y el
  // contacto cargaron bien y se siguen viendo. Una falla, un cartel.
  it('el detalle sigue en pie aunque el historial falle', () => {
    mockUsePetByID.mockReturnValue({ data: petVisible, isLoading: false });
    mockUseReportsByPetID.mockReturnValue({ data: undefined, isError: true });
    const { getByText } = render(<PetDetailScreen />);

    expect(getByText('Firulais')).toBeTruthy();
  });
});

describe('PetDetailScreen', () => {
  it('renderiza sin lanzar errores (estado de carga)', () => {
    const { toJSON } = render(<PetDetailScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('muestra el badge REGISTRADA para mascotas con status registered', () => {
    mockUsePetByID.mockReturnValue({
      data: { ...mockPetBase, status: 'registered' },
      isLoading: false,
    });
    const { queryByText } = render(<PetDetailScreen />);
    expect(queryByText(/perdido/i)).toBeNull();
  });

  it('no muestra el badge de status lost para mascotas con status found', () => {
    mockUsePetByID.mockReturnValue({
      data: { ...mockPetBase, status: 'found' },
      isLoading: false,
    });
    const { queryByText } = render(<PetDetailScreen />);
    expect(queryByText(/pets:status\.lost/i)).toBeNull();
  });

  it('routes adoption pets to the adoption body (no lost scaffolding)', () => {
    mockUsePetByID.mockReturnValue({
      data: { ...mockPetBase, status: 'adoption', city: 'Montevideo', owner: { id: 'owner-1', name: 'Ana' } },
      isLoading: false,
    });
    const { queryByTestId } = render(<PetDetailScreen />);
    // login-gate is unique to AdoptionPetBody → proves the adoption body rendered
    // in place of the lost-pet body (which has no such element).
    expect(queryByTestId('login-gate')).toBeTruthy();
  });
});
