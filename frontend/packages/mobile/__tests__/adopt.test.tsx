// Adopt screen smoke test
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import AdoptScreen from '../app/adopt';
import { drawnIcons, fillsOf } from './support/icons';
import { COLORS, SPACING } from '../constants';
import { Text, ScrollView, StyleSheet } from 'react-native';

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

  // The type chips used to live in a horizontal ScrollView and overflowed the
  // card sideways. They wrap now, so every one is visible without scrolling.
  describe('type filter chips', () => {
    beforeEach(() => {
      mockUseAdoptions.mockReturnValue({
        data: { data: [mockPet], total: 1, page: 1, limit: 20 },
        isLoading: false,
      });
    });

    it('are not inside a horizontal ScrollView', () => {
      render(<AdoptScreen />);
      const horizontal = screen.UNSAFE_getAllByType(ScrollView).filter((sv) => sv.props.horizontal);
      expect(horizontal).toEqual([]);
    });

    it('wrap in one container that holds every type chip', () => {
      render(<AdoptScreen />);
      const row = screen.getByLabelText('adoption:section.typeFilter');
      expect(StyleSheet.flatten(row.props.style).flexWrap).toBe('wrap');
      for (const label of [
        'adoption:section.allTypes',
        'pets:types.perro',
        'pets:types.gato',
        'pets:types.pajaro',
        'pets:types.otro',
      ]) {
        expect(screen.getByText(label)).toBeTruthy();
      }
    });
  });
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
const TYPE_ICONS = ['dog', 'cat', 'bird', 'pets'];
const ICONS_OF_TYPES = (ui: Parameters<typeof drawnIcons>[0]) => drawnIcons(ui).filter((n) => TYPE_ICONS.includes(n));
const TYPE_EMOJI = /[🐾🐕🐱🐦]/u;

describe('AdoptScreen — type chips draw icons', () => {
  const listed = () =>
    mockUseAdoptions.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20 },
      isLoading: false,
    });

  it('the all-types chip and each type draw their own icon, no emoji', () => {
    listed();
    const ui = render(<AdoptScreen />);
    expect(ICONS_OF_TYPES(ui)).toEqual(['pets', 'dog', 'cat', 'bird', 'pets']);
    const texts = ui.UNSAFE_getAllByType(Text).map((t) => [t.props.children].flat(Infinity).join(''));
    expect(texts.filter((s) => TYPE_EMOJI.test(s))).toEqual([]);
  });

  it('the selected chip tints its icon white and the others stay secondary (both halves)', () => {
    listed();
    const ui = render(<AdoptScreen />);
    fireEvent.press(ui.getByText('pets:types.gato'));
    expect(fillsOf(ui, 'cat')).toEqual([COLORS.white]);
    expect(fillsOf(ui, 'dog')).toEqual([COLORS.textSecondary]);
    expect(fillsOf(ui, 'bird')).toEqual([COLORS.textSecondary]);
  });
});

describe('AdoptScreen — header block aligns with the cards', () => {
  // The FlatList content container already insets everything by SPACING.lg, so
  // the header block must add no horizontal inset of its own: a second inset made
  // the filter card narrower than the PetCards below it.
  const horizontalInset = (el: { props: { style?: unknown } }) => {
    const s = StyleSheet.flatten(el.props.style as never) as Record<string, number | undefined>;
    return {
      paddingHorizontal: s.paddingHorizontal ?? 0,
      marginHorizontal: s.marginHorizontal ?? 0,
      marginLeft: s.marginLeft ?? 0,
      marginRight: s.marginRight ?? 0,
    };
  };
  const NONE = { paddingHorizontal: 0, marginHorizontal: 0, marginLeft: 0, marginRight: 0 };

  it('header, filter card and result count add no horizontal inset of their own', () => {
    mockUseAdoptions.mockReturnValue({
      data: { data: [], total: 3, page: 1, limit: 20 },
      isLoading: false,
    });
    const ui = render(<AdoptScreen />);
    expect(horizontalInset(ui.getByTestId('adopt-header'))).toEqual(NONE);
    expect(horizontalInset(ui.getByTestId('adopt-filter-card'))).toEqual(NONE);
    expect(horizontalInset(ui.getByTestId('adopt-result-count'))).toEqual(NONE);
  });

  it('the loading branch, drawn outside the FlatList, supplies the list inset itself', () => {
    mockUseAdoptions.mockReturnValue({ data: undefined, isLoading: true });
    const ui = render(<AdoptScreen />);
    expect(horizontalInset(ui.getByTestId('adopt-loading')).paddingHorizontal).toBe(SPACING.lg);
    expect(horizontalInset(ui.getByTestId('adopt-filter-card'))).toEqual(NONE);
  });
});
