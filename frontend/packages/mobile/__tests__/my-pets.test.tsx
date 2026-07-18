// My Pets screen smoke test
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import MyPetsScreen from '../app/my-pets';

// expo-router is mocked globally in jest.setup.js

jest.mock('../store', () => ({
  useLocationStore: () => ({ latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() }),
}));

const mockUseMyPets = jest.fn();
const mockUseReportedPets = jest.fn();
const mockUpdatePetMutateAsync = jest.fn();

// Screen imports via relative '../../shared/hooks'; '../../shared/hooks'
// from this test resolves to the same module.
jest.mock('../../shared/hooks', () => ({
  useMyPets: () => mockUseMyPets(),
  useReportedPets: () => mockUseReportedPets(),
  useDeletePet: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false, variables: undefined }),
  useCreateReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMarkPetAsFound: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdatePet: () => ({ mutateAsync: mockUpdatePetMutateAsync, isPending: false }),
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

const adoptedPet = {
  id: 'pet-3',
  owner_id: 'user-1',
  name: 'Rex',
  type: 'perro',
  breed: '',
  color: 'blanco',
  status: 'adopted',
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
  mockUpdatePetMutateAsync.mockClear();
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

  it('muestra "Marcar adoptado" para una mascota en adopción y no para una ya adoptada', () => {
    mockUseMyPets.mockReturnValue({
      data: [ownedPet, adoptionPet, adoptedPet],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    render(<MyPetsScreen />);
    fireEvent.press(screen.getByText('adoption:profile.tab'));

    // adoptionPet ('Michi', status 'adoption') gets the action.
    expect(screen.getAllByText('adoption:profile.markAdopted')).toHaveLength(1);
    // adoptedPet ('Rex', status 'adopted') does not.
    expect(screen.getByText('Rex')).toBeTruthy();
  });

  it('al confirmar "Marcar adoptado" llama a useUpdatePet con status adopted', () => {
    // i18next.t() is called on the bare singleton here (not via the react-i18next
    // hook), so without an initialized instance button labels resolve to `undefined`
    // in this test env — match by position (mirrors [cancel, confirm] order) instead.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.[1]?.onPress?.();
    });

    mockUseMyPets.mockReturnValue({
      data: [ownedPet, adoptionPet],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    render(<MyPetsScreen />);
    fireEvent.press(screen.getByText('adoption:profile.tab'));
    fireEvent.press(screen.getByText('adoption:profile.markAdopted'));

    expect(mockUpdatePetMutateAsync).toHaveBeenCalledWith({
      id: 'pet-2',
      data: { status: 'adopted' },
    });

    alertSpy.mockRestore();
  });
});
