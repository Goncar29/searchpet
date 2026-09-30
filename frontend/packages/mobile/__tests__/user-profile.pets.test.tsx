// Publicaciones en el perfil público de OTRA persona (auditoría M6): la
// pantalla nunca llamaba a `useUserPets`, así que lo publicado no se veía.
//
// Se prueban las DOS mitades de cada distinción (regla #60/#63): lista caída vs
// lista vacía, y recorte real vs total ausente.
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import UserProfileScreen from '../app/users/[id]';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'u-9' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

const mockUsePublicProfile = jest.fn();
const mockUseUserPets = jest.fn();
const mockUseUserReviews = jest.fn();
const mockUseBlockedUsers = jest.fn();
const mockUseAuthStore = jest.fn();

jest.mock('../../shared/hooks', () => ({
  usePublicProfile: (...a: unknown[]) => mockUsePublicProfile(...a),
  useUserPets: (...a: unknown[]) => mockUseUserPets(...a),
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
  share_count: 0,
  avg_rating: 0,
  badges: [] as unknown[],
  review_count: 0,
  created_at: '2026-01-01T00:00:00Z',
};

const pet = (id: string, name: string, status: string) => ({
  id,
  name,
  status,
  type: 'perro',
  photos: [],
  created_at: '2026-01-01T00:00:00Z',
});

const petsOk = (data: unknown[], total: number) => ({
  data: { data, total },
  isLoading: false,
  isPending: false,
  isError: false,
  isPaused: false,
  refetch: jest.fn(),
});

beforeEach(() => {
  mockPush.mockClear();
  mockUseAuthStore.mockReturnValue({ user: { id: 'yo' }, isAuthenticated: true });
  mockUseUserReviews.mockReturnValue({ data: { reviews: [] }, isLoading: false, isError: false });
  mockUseBlockedUsers.mockReturnValue({ data: [], isLoading: false, isError: false });
  mockUsePublicProfile.mockReturnValue({
    data: perfil,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  });
});

describe('Perfil público — mascotas publicadas', () => {
  it('reparte lo publicado y lo ofrecido en adopción en su sección', () => {
    mockUseUserPets.mockReturnValue(
      petsOk([pet('p1', 'Firulais', 'lost'), pet('p2', 'Michi', 'adoption')], 2),
    );
    const { queryByText, queryByTestId } = render(<UserProfileScreen />);
    expect(queryByTestId('user-pets-loading')).toBeNull();
    expect(queryByText('users:posts')).toBeTruthy();
    expect(queryByText('users:adoption')).toBeTruthy();
    expect(queryByText('Firulais')).toBeTruthy();
    expect(queryByText('Michi')).toBeTruthy();
    expect(queryByText('users:postsEmpty')).toBeNull();
    expect(queryByText('users:postsError')).toBeNull();
  });

  it('tocar una tarjeta navega al detalle de la mascota', () => {
    mockUseUserPets.mockReturnValue(petsOk([pet('p1', 'Firulais', 'lost')], 1));
    const { getByText } = render(<UserProfileScreen />);
    fireEvent.press(getByText('Firulais'));
    expect(mockPush).toHaveBeenCalledWith('/pet/p1');
  });

  it('sin nada en adopción la sección de adopción no se dibuja', () => {
    mockUseUserPets.mockReturnValue(petsOk([pet('p1', 'Firulais', 'lost')], 1));
    const { queryByText } = render(<UserProfileScreen />);
    expect(queryByText('users:adoption')).toBeNull();
  });

  it('query caída SIN datos: cartel de error, NO el texto de vacío', () => {
    mockUseUserPets.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      isPaused: false,
      refetch: jest.fn(),
    });
    const { queryByText, queryAllByText } = render(<UserProfileScreen />);
    expect(queryByText('users:postsError')).toBeTruthy();
    expect(queryByText('users:postsEmpty')).toBeNull();
    // Una falla, un cartel: la sección de adopción no lleva el suyo.
    expect(queryAllByText('users:postsError')).toHaveLength(1);
    expect(queryByText('users:adoption')).toBeNull();
  });

  it('cargando: indicador, sin afirmar vacío ni error', () => {
    mockUseUserPets.mockReturnValue({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      isPaused: false,
      refetch: jest.fn(),
    });
    const { queryByText, queryByTestId } = render(<UserProfileScreen />);
    expect(queryByTestId('user-pets-loading')).toBeTruthy();
    expect(queryByText('users:postsEmpty')).toBeNull();
    expect(queryByText('users:postsError')).toBeNull();
  });

  it('refetch caído CON datos: la lista sigue y aparece el aviso, no el cartel', () => {
    mockUseUserPets.mockReturnValue({
      ...petsOk([pet('p1', 'Firulais', 'lost'), pet('p2', 'Michi', 'adoption')], 2),
      isError: true,
    });
    const { queryByText, queryAllByText } = render(<UserProfileScreen />);
    expect(queryByText('Firulais')).toBeTruthy();
    expect(queryByText('Michi')).toBeTruthy();
    expect(queryAllByText('common:staleTitle')).toHaveLength(1);
    expect(queryByText('users:postsError')).toBeNull();
    expect(queryByText('users:postsEmpty')).toBeNull();
  });

  it('datos vacíos: texto de vacío, NO el cartel de error', () => {
    mockUseUserPets.mockReturnValue(petsOk([], 0));
    const { queryByText } = render(<UserProfileScreen />);
    expect(queryByText('users:postsEmpty')).toBeTruthy();
    expect(queryByText('users:postsError')).toBeNull();
  });

  it('avisa el recorte cuando total > mostradas', () => {
    mockUseUserPets.mockReturnValue(
      petsOk([pet('p1', 'Firulais', 'lost'), pet('p2', 'Michi', 'adoption')], 300),
    );
    const { queryByText } = render(<UserProfileScreen />);
    expect(queryByText('users:postsCapped')).toBeTruthy();
  });

  it('no avisa recorte cuando total == mostradas', () => {
    mockUseUserPets.mockReturnValue(petsOk([pet('p1', 'Firulais', 'lost')], 1));
    const { queryByText } = render(<UserProfileScreen />);
    expect(queryByText('users:postsCapped')).toBeNull();
  });

  it('no avisa recorte con total = 0 y lista NO vacía (header ausente)', () => {
    mockUseUserPets.mockReturnValue(petsOk([pet('p1', 'Firulais', 'lost')], 0));
    const { queryByText } = render(<UserProfileScreen />);
    expect(queryByText('users:postsCapped')).toBeNull();
  });
});
