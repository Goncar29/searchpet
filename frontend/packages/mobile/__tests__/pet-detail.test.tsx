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

jest.mock('@shared/hooks', () => ({
  usePetByID: () => ({ data: null, isLoading: true }),
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

describe('PetDetailScreen', () => {
  it('renderiza sin lanzar errores (estado de carga)', () => {
    const { toJSON } = render(<PetDetailScreen />);
    expect(toJSON()).toBeTruthy();
  });
});
