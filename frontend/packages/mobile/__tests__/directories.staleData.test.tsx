// Casas de acogida y refugios cuando un refetch falla PERO la lista ya estaba
// (auditoría M8). React Query conserva `data` al fallar un refetch; sin aviso,
// el usuario mira datos viejos sin saberlo.
//
// Se prueban las dos mitades (regla #60): con datos, la lista sigue y aparece la
// franja; sin datos, aparece el cartel de error y NO la franja. Y el caso de
// una lista cacheada VACÍA: es una respuesta, no ignorancia, así que se dibuja
// el texto de vacío con la franja, nunca el cartel de error.
import React from 'react';
import { render } from '@testing-library/react-native';
import FosterHomesScreen from '../app/foster-homes/index';
import SheltersScreen from '../app/shelters/index';

const mockUseFosterHomes = jest.fn();
const mockUseShelters = jest.fn();

// Casas de acogida importa por alias y refugios por ruta relativa, pero los dos
// resuelven al MISMO módulo: con un mock por especificador el segundo pisa al
// primero. Un solo mock, con los dos hooks, registrado para ambos.
jest.mock('@shared/hooks', () => ({
  useFosterHomes: (...args: unknown[]) => mockUseFosterHomes(...args),
  useShelters: (...args: unknown[]) => mockUseShelters(...args),
  // The directory footer (register CTA) reads the owner view.
  useMyShelter: () => ({ data: undefined, isLoading: false }),
}));
jest.mock('../../shared/hooks', () => ({
  useFosterHomes: (...args: unknown[]) => mockUseFosterHomes(...args),
  useShelters: (...args: unknown[]) => mockUseShelters(...args),
  // The directory footer (register CTA) reads the owner view.
  useMyShelter: () => ({ data: undefined, isLoading: false }),
}));

const fosterHome = {
  id: 'fh-1',
  owner_user_id: 'user-1',
  city: 'Montevideo',
  housing_type: 'house',
  animal_types: ['dog'],
  capacity: 3,
  description: 'Casa con patio grande',
  photos: [],
  created_at: '2024-01-01T00:00:00Z',
};

const shelter = {
  id: 's-1',
  name: 'Refugio Patitas',
  city: 'Montevideo',
  description: 'Refugio de perros',
  is_verified: true,
  created_at: '2024-01-01T00:00:00Z',
};

const query = (data: unknown, isError: boolean) => ({
  data,
  isLoading: false,
  isPending: false,
  isError,
  isPaused: false,
  refetch: jest.fn(),
});

describe('Casas de acogida — refetch fallido', () => {
  it('con datos cacheados: la lista sigue y aparece la franja, no el cartel', () => {
    mockUseFosterHomes.mockReturnValue(query([fosterHome], true));
    const { queryByText, queryAllByText } = render(<FosterHomesScreen />);
    expect(queryByText('Casa con patio grande')).toBeTruthy();
    expect(queryAllByText('common:staleTitle')).toHaveLength(1);
    expect(queryByText('common:error')).toBeNull();
  });

  it('sin datos: cartel de error y ninguna franja', () => {
    mockUseFosterHomes.mockReturnValue(query(undefined, true));
    const { queryByText } = render(<FosterHomesScreen />);
    expect(queryByText('common:error')).toBeTruthy();
    expect(queryByText('common:staleTitle')).toBeNull();
  });

  it('lista cacheada vacía: texto de vacío con la franja, no el cartel', () => {
    mockUseFosterHomes.mockReturnValue(query([], true));
    const { queryByText } = render(<FosterHomesScreen />);
    expect(queryByText('fosterHomes:directory.empty')).toBeTruthy();
    expect(queryByText('common:staleTitle')).toBeTruthy();
    expect(queryByText('common:error')).toBeNull();
  });

  it('sin error: ni franja ni cartel', () => {
    mockUseFosterHomes.mockReturnValue(query([fosterHome], false));
    const { queryByText } = render(<FosterHomesScreen />);
    expect(queryByText('Casa con patio grande')).toBeTruthy();
    expect(queryByText('common:staleTitle')).toBeNull();
  });
});

describe('Refugios — refetch fallido', () => {
  it('con datos cacheados: la lista sigue y aparece la franja, no el cartel', () => {
    mockUseShelters.mockReturnValue(query([shelter], true));
    const { queryByText, queryAllByText } = render(<SheltersScreen />);
    expect(queryByText('Refugio Patitas')).toBeTruthy();
    expect(queryAllByText('common:staleTitle')).toHaveLength(1);
    expect(queryByText('errorMessage')).toBeNull();
  });

  it('sin datos: cartel de error y ninguna franja', () => {
    mockUseShelters.mockReturnValue(query(undefined, true));
    const { queryByText } = render(<SheltersScreen />);
    expect(queryByText('errorMessage')).toBeTruthy();
    expect(queryByText('common:staleTitle')).toBeNull();
  });

  it('lista cacheada vacía: texto de vacío con la franja, no el cartel', () => {
    mockUseShelters.mockReturnValue(query([], true));
    const { queryByText } = render(<SheltersScreen />);
    expect(queryByText('emptyTitle')).toBeTruthy();
    expect(queryByText('common:staleTitle')).toBeTruthy();
    expect(queryByText('errorMessage')).toBeNull();
  });

  it('sin error: ni franja ni cartel', () => {
    mockUseShelters.mockReturnValue(query([shelter], false));
    const { queryByText } = render(<SheltersScreen />);
    expect(queryByText('Refugio Patitas')).toBeTruthy();
    expect(queryByText('common:staleTitle')).toBeNull();
  });
});
