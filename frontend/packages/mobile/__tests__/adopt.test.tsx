// Adopt screen smoke test
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import AdoptScreen from '../app/adopt';

// expo-router is mocked globally in jest.setup.js

const mockUseAdoptions = jest.fn();

// Screen imports via relative '../../shared/hooks'; '../../shared/hooks'
// from this test resolves to the same module.
jest.mock('../../shared/hooks', () => ({
  useAdoptions: () => mockUseAdoptions(),
}));

const mockPet = {
  id: 'pet-1',
  owner_id: 'user-1',
  name: 'Firulais',
  type: 'perro',
  breed: 'Labrador',
  color: 'amarillo',
  status: 'adoption',
  city: 'Montevideo',
  photos: [],
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  mockUseAdoptions.mockReturnValue({ data: undefined, isLoading: true });
});

describe('AdoptScreen', () => {
  it('renderiza sin lanzar errores (estado de carga)', () => {
    const { toJSON } = render(<AdoptScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('muestra el estado vacío cuando no hay mascotas en adopción', () => {
    mockUseAdoptions.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20 },
      isLoading: false,
    });
    render(<AdoptScreen />);
    expect(screen.queryByText(/adoption:section.empty/i)).toBeTruthy();
  });

  it('muestra una mascota en adopción', () => {
    mockUseAdoptions.mockReturnValue({
      data: { data: [mockPet], total: 1, page: 1, limit: 20 },
      isLoading: false,
    });
    render(<AdoptScreen />);
    expect(screen.getByText('Firulais')).toBeTruthy();
  });
});
