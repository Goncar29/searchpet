// Qué muestra el perfil público de otro usuario cuando un refetch falla PERO el
// perfil ya estaba cargado.
//
// Misma clase que `leaderboard` y `badges`, sobre un OBJETO en vez de una lista:
// `if (isError || !profile)` manda al cartel aunque `profile` esté ahí. Esta
// pantalla tiene pull-to-refresh, así que el estado se alcanza a propósito.
import React from 'react';
import { render } from '@testing-library/react-native';
import UserProfileScreen from '../app/users/[id]';

// El mock global de expo-router (jest.setup.js) NO trae `useNavigation`, y esta
// pantalla lo usa para el título del header. Sin esto el render explota con
// "useNavigation is not a function" y los DOS casos fallan — o sea que parecería
// un defecto del código cuando es del arnés.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'u-9' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

const mockUsePublicProfile = jest.fn();
const mockUseUserReviews = jest.fn();
const mockUseBlockedUsers = jest.fn();
const mockUseAuthStore = jest.fn();

jest.mock('../../shared/hooks', () => ({
  usePublicProfile: (...a: unknown[]) => mockUsePublicProfile(...a),
  useUserReviews: (...a: unknown[]) => mockUseUserReviews(...a),
  useBlockedUsers: (...a: unknown[]) => mockUseBlockedUsers(...a),
  useCreateReview: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useUpdateReview: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useBlockUser: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useSubmitAbuseReport: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('../store', () => ({
  useAuthStore: (...a: unknown[]) => mockUseAuthStore(...a),
}));

const perfil = {
  id: 'u-9',
  name: 'Marina Torres',
  city: 'Montevideo',
  total_points: 42,
  found_count: 1,
  total_reports: 3,
  badges: [] as unknown[],
  average_rating: 0,
  review_count: 0,
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  mockUseAuthStore.mockReturnValue({ user: { id: 'yo' }, isAuthenticated: true });
  mockUseUserReviews.mockReturnValue({ data: { reviews: [] }, isLoading: false, isError: false });
  mockUseBlockedUsers.mockReturnValue({ data: [], isLoading: false, isError: false });
});

describe('Perfil público — un refetch fallido no puede borrar el perfil', () => {
  it('con perfil cacheado y refetch fallido, el perfil sigue en pantalla', () => {
    mockUsePublicProfile.mockReturnValue({
      data: perfil,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<UserProfileScreen />);
    expect(queryByText('Marina Torres')).toBeTruthy();
    // El cartel que reemplaza la pantalla NO aparece...
    expect(queryByText('users:loadError')).toBeNull();
    // ...y en su lugar sí avisa la franja de datos viejos. Sin ella el
    // RefreshControl deja de girar y nada le dice al usuario que lo que ve
    // puede no ser lo último: un error invisible en vez de uno falso.
    expect(queryByText('common:staleTitle')).toBeTruthy();
  });

  it('sin perfil y con error, muestra el cartel en vez del perfil', () => {
    mockUsePublicProfile.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<UserProfileScreen />);
    // Se afirma que el cartel APARECE, no sólo que el nombre no está: sin
    // perfil y sin cartel el `toBeNull()` de abajo también pasaría.
    expect(queryByText('users:loadError')).toBeTruthy();
    expect(queryByText('Marina Torres')).toBeNull();
  });
});
