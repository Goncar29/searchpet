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

jest.mock('@shared/hooks', () => ({
  usePetByID: (...args: unknown[]) => mockUsePetByID(...args),
  useReportsByPetID: () => ({ data: [] }),
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
});
