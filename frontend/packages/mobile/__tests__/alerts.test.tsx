// Alerts screen smoke test
import React from 'react';
import { render } from '@testing-library/react-native';
import AlertsScreen from '../app/alerts/index';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));

jest.mock('../store', () => ({
  useLocationStore: () => ({ latitude: null, longitude: null, setLocation: jest.fn() }),
  useAuthStore: (selector) => {
    const state = { user: { id: 'user-1', name: 'Me' }, isAuthenticated: true };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

const mockUseAlerts = jest.fn();

// Screen imports via relative '../../../shared/hooks'; '../../shared/hooks'
// from this test resolves to the same module.
jest.mock('../../shared/hooks', () => ({
  useAlerts: () => mockUseAlerts(),
  useCreateAlert: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateAlert: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteAlert: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// apiErrors is imported relatively too; mock it so getErrorMessage is a no-op.
jest.mock('../../shared/utils/apiErrors', () => ({
  getErrorMessage: () => 'error',
}));

const mockAlert = {
  id: 'alert-1',
  name: 'Casa',
  alert_latitude: -34.9011,
  alert_longitude: -56.1645,
  radius_km: 5,
  pet_type: '',
  is_active: true,
};

beforeEach(() => {
  mockUseAlerts.mockReturnValue({ data: undefined, isLoading: true });
});

describe('AlertsScreen', () => {
  it('renderiza sin lanzar errores (estado de carga)', () => {
    const { toJSON } = render(<AlertsScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('muestra el estado vacío cuando no hay alertas', () => {
    mockUseAlerts.mockReturnValue({ data: [], isLoading: false });
    const { queryByText } = render(<AlertsScreen />);
    expect(queryByText(/alerts:emptyTitle/i)).toBeTruthy();
  });

  it('muestra el nombre de una alerta existente', () => {
    mockUseAlerts.mockReturnValue({ data: [mockAlert], isLoading: false });
    const { queryByText } = render(<AlertsScreen />);
    expect(queryByText('Casa')).toBeTruthy();
  });
});
