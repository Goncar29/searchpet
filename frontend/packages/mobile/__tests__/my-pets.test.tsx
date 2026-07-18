// My Pets screen smoke test
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import MyPetsScreen from '../app/my-pets';

// expo-router is mocked globally in jest.setup.js

jest.mock('../store', () => ({
  useLocationStore: () => ({ latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() }),
}));

const mockUseMyPets = jest.fn();
const mockUseReportedPets = jest.fn();

// Screen imports via relative '../../shared/hooks'; '../../shared/hooks'
// from this test resolves to the same module.
jest.mock('../../shared/hooks', () => ({
  useMyPets: () => mockUseMyPets(),
  useReportedPets: () => mockUseReportedPets(),
  useDeletePet: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false, variables: undefined }),
  useCreateReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMarkPetAsFound: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const ownedPet = {
  id: 'pet-1',
  owner_id: 'user-1',
  name: 'Firulais',
  type: 'perro',
  breed: 'Labrador',
  color: 'negro',
  status: 'registered',
  photos: [],
  created_at: new Date().toISOString(),
};

const adoptionPet = {
  id: 'pet-2',
  owner_id: 'user-1',
  name: 'Michi',
  type: 'gato',
  breed: '',
  color: 'gris',
  status: 'adoption',
  photos: [],
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  mockUseMyPets.mockReturnValue({
    data: [ownedPet, adoptionPet],
    isLoading: false,
    refetch: jest.fn(),
    isRefetching: false,
  });
  mockUseReportedPets.mockReturnValue({
    data: [],
    isLoading: false,
    refetch: jest.fn(),
    isRefetching: false,
  });
});

describe('MyPetsScreen', () => {
  it('renderiza sin lanzar errores', () => {
    const { toJSON } = render(<MyPetsScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('el tab "owned" excluye mascotas en adopción', () => {
    render(<MyPetsScreen />);
    expect(screen.getByText('Firulais')).toBeTruthy();
    expect(screen.queryByText('Michi')).toBeNull();
  });

  it('el tab "En adopción" muestra solo mascotas en adopción/adoptadas', () => {
    render(<MyPetsScreen />);
    const adoptionTab = screen.getByText('adoption:profile.tab');
    fireEvent.press(adoptionTab);

    expect(screen.getByText('Michi')).toBeTruthy();
    expect(screen.queryByText('Firulais')).toBeNull();
  });
});
