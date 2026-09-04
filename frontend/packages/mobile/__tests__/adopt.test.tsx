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

  // La mitad positiva la afirma el test de arriba, que sigue exigiendo el cartel
  // de vacío con `data: { data: [] }`. Las dos hacen falta: sin la positiva, un
  // guard escrito de más taparía también el vacío real y nadie se enteraría.
  it('una consulta caída avisa que falló, y NO se ve como "no hay nada en adopción"', () => {
    mockUseAdoptions.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<AdoptScreen />);

    expect(screen.queryByText(/common:loadErrorTitle/i)).toBeTruthy();
    expect(screen.queryByText(/adoption:section.empty/i)).toBeNull();
  });

  // El contador vive FUERA de la lista, y ésa es la trampa que la primitiva no
  // puede cerrar sola: con la consulta caída, `data?.total ?? pets.length` da
  // CERO y la pantalla afirmaba "0 resultados". Un cartel de vacío no dice nada
  // sobre por qué; un contador en cero AFIRMA que se preguntó y no había.
  //
  // Hoy no se dibuja porque el encabezado va dentro de la FlatList que
  // `ListState` reemplaza. Este test existe para que siga siendo cierto si
  // alguien mueve el encabezado afuera, que es justo lo que haría falta para
  // conservar los filtros durante el error.
  it('una consulta caída no afirma "0 resultados"', () => {
    mockUseAdoptions.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<AdoptScreen />);

    expect(screen.queryByText(/adoption:section.resultCount/i)).toBeNull();
  });

  it('sin conexión avisa que es la red, no que no haya mascotas', () => {
    mockUseAdoptions.mockReturnValue({ data: undefined, isLoading: false, isPaused: true });
    render(<AdoptScreen />);

    expect(screen.queryByText(/common:offlineTitle/i)).toBeTruthy();
    expect(screen.queryByText(/adoption:section.empty/i)).toBeNull();
    expect(screen.queryByText(/common:loadErrorTitle/i)).toBeNull();
  });
});
