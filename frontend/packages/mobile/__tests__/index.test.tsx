// Home/Feed screen
import React from 'react';
import { render } from '@testing-library/react-native';

import HomeScreen from '../app/(tabs)/index';

// expo-router is mocked in jest.setup.js

jest.mock('../store', () => ({
  useAuthStore: (selector) => {
    const state = {
      login: jest.fn(),
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// Un objeto mutable en vez de un valor fijo: `ListState` ramifica sobre CINCO
// campos de la query (`isLoading`, `isPaused`, `isPending`, `isError` y `data`),
// y un mock que sólo devuelve `{ data: [], isLoading: false }` no puede llegar a
// ninguna de las ramas que este cambio agrega.
const nearby: any = {};
const refetch = jest.fn();

function estadoDeQuery(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isPaused: false,
    isError: false,
    isRefetching: false,
    refetch,
    ...over,
  };
}

jest.mock('@shared/hooks', () => ({
  useNearbyReports: () => nearby,
  useSearchPets: () => ({
    data: undefined,
    isLoading: false,
    isPending: true,
    isPaused: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useStories: () => ({ data: [], isLoading: false }),
  useImageClassify: () => ({ classify: jest.fn(), isModelLoading: false, isClassifying: false, error: null }),
  useImageSearchNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// Se dibuja el nombre en vez de `null`: sin esto no hay forma de afirmar que la
// lista sigue en pantalla cuando falla un refetch sobre datos cacheados.
// `require` adentro de la fábrica y `createElement` en vez de JSX: `jest.mock`
// se iza por encima de los imports, así que una referencia a `Text` de afuera
// explota con "not allowed to reference any out-of-scope variables".
jest.mock('../components/PetCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    // El feed pasa `report` en modo cercanía y `pet` en modo búsqueda, así que
    // el mock lee los dos: atarlo a uno solo haría que el test dependiera del
    // modo en vez de del estado de la query, que es lo que acá se prueba.
    PetCard: ({ pet, report }: any) =>
      React.createElement(Text, null, `pet:${report?.pet?.name ?? pet?.name ?? '?'}`),
  };
});

// Un reporte, no una mascota: `useNearbyReports` devuelve reportes con la
// mascota adentro.
const reporte = (name: string) => ({
  id: `report-${name}`,
  pet_id: `pet-${name}`,
  pet: { id: `pet-${name}`, name, type: 'dog', status: 'lost', photos: [] },
});

beforeEach(() => {
  refetch.mockClear();
  Object.assign(nearby, estadoDeQuery());
});

describe('HomeScreen (Feed)', () => {
  it('renderiza sin lanzar errores', () => {
    Object.assign(nearby, estadoDeQuery({ data: [] }));
    const { toJSON } = render(<HomeScreen />);
    expect(toJSON()).toBeTruthy();
  });

  // ── Una consulta caída no es un barrio sin mascotas perdidas ──────────
  //
  // El cartel vacío del feed dice, literalmente, "No se encontraron mascotas
  // perdidas en tu zona. ¡Eso es bueno!". Con `data ?? []` eso es lo que veía
  // alguien cuyo pedido falló: la app lo felicitaba mientras el servidor estaba
  // caído, en la pantalla principal de una app para encontrar mascotas perdidas.
  describe('cuando no pudimos leer la lista', () => {
    it('no dice que no hay nada cerca, y ofrece reintentar', () => {
      Object.assign(nearby, estadoDeQuery({ isError: true }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText(/home:noNearbyText/)).toBeNull();
      expect(queryByText(/home:noNearbyTitle/)).toBeNull();
      expect(queryByText(/common:loadErrorTitle/)).toBeTruthy();
      expect(queryByText(/common:retry/)).toBeTruthy();
    });

    // El encabezado vive FUERA de la rama que envuelve `ListState`, así que la
    // primitiva no lo cubre: es la trampa que dejó documentada el porte de la
    // web. Sin este arreglo la pantalla mostraba el cartel de error Y, tres
    // líneas más arriba, "0 reportes activos" — afirmando el número que acababa
    // de admitir que no sabe.
    it('el encabezado no afirma un conteo que no tenemos', () => {
      Object.assign(nearby, estadoDeQuery({ isError: true }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText(/home:activeReports/)).toBeNull();
      expect(queryByText(/home:radiusOnly/)).toBeTruthy();
    });

    it('sin conexión lo dice como falta de red, no como error del servidor', () => {
      Object.assign(nearby, estadoDeQuery({ isPaused: true }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText(/common:offlineTitle/)).toBeTruthy();
      expect(queryByText(/common:offlineBody/)).toBeTruthy();
      expect(queryByText(/common:loadErrorTitle/)).toBeNull();
      expect(queryByText(/home:noNearbyText/)).toBeNull();
    });
  });

  // ── La otra mitad: lo que NO tiene que cambiar ────────────────────────
  //
  // Sin estas dos, las de arriba se satisfacen borrando el estado vacío y
  // mostrando el error siempre. Ahí el bug quedaría dado vuelta en vez de
  // arreglado, y ningún assert negativo lo notaría.
  describe('cuando sí pudimos leer', () => {
    it('una lista vacía de verdad sigue diciendo que no hay nada cerca', () => {
      Object.assign(nearby, estadoDeQuery({ data: [] }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText(/home:noNearbyTitle/)).toBeTruthy();
      expect(queryByText(/common:loadErrorTitle/)).toBeNull();
      expect(queryByText(/home:activeReports/)).toBeTruthy();
    });

    it('con datos, se ven las mascotas', () => {
      Object.assign(nearby, estadoDeQuery({ data: [reporte('Rex')] }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText('pet:Rex')).toBeTruthy();
      expect(queryByText(/home:noNearbyTitle/)).toBeNull();
    });

    // React Query CONSERVA lo cacheado cuando falla un refetch. Con `isError` a
    // secas —sin mirar si hay datos— un cold start de Render le BORRARÍA al
    // usuario la lista que ya estaba en pantalla y la reemplazaría por un
    // cartel. Mostrar datos viejos avisando es mejor que borrar los buenos.
    it('un refetch fallido conserva la lista y sólo avisa', () => {
      Object.assign(nearby, estadoDeQuery({ data: [reporte('Rex')], isError: true }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText('pet:Rex')).toBeTruthy();
      expect(queryByText(/common:staleTitle/)).toBeTruthy();
      expect(queryByText(/common:loadErrorTitle/)).toBeNull();
    });
  });
});
