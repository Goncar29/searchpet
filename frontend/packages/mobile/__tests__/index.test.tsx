// Home/Feed screen — feed unificado vía useSearchPets (como web)
import React from 'react';
import { RefreshControl } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

import HomeScreen from '../app/(tabs)/index';
import { drawnIcons, fillsOf } from './support/icons';
import { COLORS } from '../constants';
import { Text } from 'react-native';

// expo-router is mocked in jest.setup.js

jest.mock('../store', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      login: jest.fn(),
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// El feed SIEMPRE sale de useSearchPets — ya no hay un modo "cercanía" con su
// propio hook; `useNearbyReports` se queda sólo en el mapa (app/(tabs)/map.tsx).
// Un objeto mutable, no un valor fijo: `ListState` ramifica sobre CINCO campos
// de la query (`isLoading`, `isPaused`, `isPending`, `isError` y `data`), y un
// mock que sólo devuelve `{ data: {...}, isLoading: false }` no puede llegar a
// ninguna de esas ramas. `mockUseSearchPets` además graba los params de cada
// llamada, para poder afirmar qué le pide la pantalla al hook.
const search: any = {};
const refetch = jest.fn();
const mockUseSearchPets = jest.fn((_params?: any) => ({ ...search }));

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
  useSearchPets: (params: any) => mockUseSearchPets(params),
  useStories: () => ({ data: [], isLoading: false }),
  useImageClassify: () => ({ classify: jest.fn(), isModelLoading: false, isClassifying: false, error: null }),
  useImageSearchNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// Se dibuja el nombre en vez de `null`: sin esto no hay forma de afirmar que la
// lista sigue en pantalla cuando falla un refetch sobre datos cacheados, ni que
// cada card recibió la variante `pet`. `require` adentro de la fábrica y
// `createElement` en vez de JSX: `jest.mock` se iza por encima de los imports,
// así que una referencia a `Text` de afuera explota con "not allowed to
// reference any out-of-scope variables".
const mockPetCardRender = jest.fn((_props: any) => {});
jest.mock('../components/PetCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    PetCard: (props: any) => {
      mockPetCardRender(props);
      return React.createElement(Text, null, `pet:${props.pet?.name ?? '?'}`);
    },
  };
});

// Una mascota, no un reporte: el feed unificado pasa SIEMPRE la variante `pet`
// de PetCard — la variante `report` (modo cercanía) ya no existe acá.
const mascota = (name: string) => ({
  id: `pet-${name}`,
  name,
  type: 'dog',
  status: 'lost',
  photos: [],
});

beforeEach(() => {
  refetch.mockClear();
  mockUseSearchPets.mockClear();
  // Sin esto, las cards dibujadas por un test anterior satisfacen las
  // aserciones del siguiente.
  mockPetCardRender.mockClear();
  Object.assign(search, estadoDeQuery());
});

describe('HomeScreen (Feed)', () => {
  it('renderiza sin lanzar errores', () => {
    Object.assign(search, estadoDeQuery({ data: { data: [], total: 0 } }));
    const { toJSON } = render(<HomeScreen />);
    expect(toJSON()).toBeTruthy();
  });

  // ── El feed SIEMPRE sale de useSearchPets ─────────────────────────────
  it('sin filtros, el feed llama a useSearchPets sin radio (sin lat/lng/radiusMeters)', () => {
    Object.assign(search, estadoDeQuery({ data: { data: [mascota('Rex')], total: 1 } }));
    render(<HomeScreen />);

    expect(mockUseSearchPets).toHaveBeenCalled();
    const params = mockUseSearchPets.mock.calls[0]![0];
    expect(params.lat).toBeUndefined();
    expect(params.lng).toBeUndefined();
    expect(params.radiusMeters).toBeUndefined();
  });

  it('renderiza cada resultado del feed con la variante pet de PetCard, nunca report', () => {
    Object.assign(search, estadoDeQuery({ data: { data: [mascota('Rex')], total: 1 } }));
    render(<HomeScreen />);

    expect(mockPetCardRender).toHaveBeenCalledWith(
      expect.objectContaining({ pet: expect.objectContaining({ id: 'pet-Rex' }) }),
    );
    expect(mockPetCardRender.mock.calls.every(([props]) => props.report === undefined)).toBe(true);
  });

  // ── El radio es un filtro OPCIONAL sobre el mismo feed, no un modo aparte ──
  it('aplicar un radio agrega lat/lng/radiusMeters a la búsqueda; re-tap lo quita', () => {
    Object.assign(search, estadoDeQuery({ data: { data: [mascota('Rex')], total: 1 } }));
    const { getByText } = render(<HomeScreen />);

    // Abrir la sección de filtros extra y elegir 5 km
    fireEvent.press(getByText(/home:more/));
    fireEvent.press(getByText('5 km'));

    let params = mockUseSearchPets.mock.calls.at(-1)![0];
    expect(params.radiusMeters).toBe(5000);
    expect(params.lat).toBe(-34.9011);
    expect(params.lng).toBe(-56.1645);

    // Tap sobre el chip activo → deselecciona el filtro de distancia
    fireEvent.press(getByText('5 km'));
    params = mockUseSearchPets.mock.calls.at(-1)![0];
    expect(params.radiusMeters).toBeUndefined();
    expect(params.lat).toBeUndefined();
    expect(params.lng).toBeUndefined();
  });

  it('limpiar filtros resetea también el radio', () => {
    Object.assign(search, estadoDeQuery({ data: { data: [mascota('Rex')], total: 1 } }));
    const { getByText } = render(<HomeScreen />);

    fireEvent.press(getByText(/home:more/));
    fireEvent.press(getByText('10 km'));
    expect(mockUseSearchPets.mock.calls.at(-1)![0].radiusMeters).toBe(10000);

    // Con radio activo el header pasa a modo resultados y ofrece limpiar. Hay
    // datos en pantalla (no una lista vacía), así que el botón de la lista
    // vacía (`home:clearFiltersButton`) no compite con éste por el regex.
    fireEvent.press(getByText(/home:clearFilters/));
    const params = mockUseSearchPets.mock.calls.at(-1)![0];
    expect(params.radiusMeters).toBeUndefined();
  });

  // ── Una consulta caída no es un feed sin mascotas en búsqueda ──────────
  //
  // El cartel vacío del feed dice, literalmente, "Todavía no hay mascotas
  // perdidas o callejeras publicadas. ¡Eso es bueno!". Con `data ?? []` eso es
  // lo que veía alguien cuyo pedido falló: la app lo felicitaba mientras el
  // servidor estaba caído, en la pantalla principal de una app para encontrar
  // mascotas perdidas.
  describe('cuando no pudimos leer la lista', () => {
    it('no dice que no hay mascotas en búsqueda, y ofrece reintentar', () => {
      Object.assign(search, estadoDeQuery({ isError: true }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText(/home:emptyFeedText/)).toBeNull();
      expect(queryByText(/home:emptyFeedTitle/)).toBeNull();
      expect(queryByText(/common:loadErrorTitle/)).toBeTruthy();
      expect(queryByText(/common:retry/)).toBeTruthy();
    });

    // Antes sólo se reintentaba en el modo cercanía; ahora el feed es la
    // búsqueda, así que reintentar tiene que volver a pedir ESA query.
    it('reintentar vuelve a pedir la búsqueda', () => {
      Object.assign(search, estadoDeQuery({ isError: true }));

      const { getByText } = render(<HomeScreen />);
      expect(refetch).not.toHaveBeenCalled();
      fireEvent.press(getByText(/common:retry/));

      expect(refetch).toHaveBeenCalled();
    });

    // El encabezado vive FUERA de la rama que envuelve `ListState`, así que la
    // primitiva no lo cubre: es la trampa que dejó documentada el porte de la
    // web. Sin este arreglo la pantalla mostraba el cartel de error Y, tres
    // líneas más arriba, "N mascotas en búsqueda" — afirmando el número que
    // acababa de admitir que no sabe.
    it('el encabezado no afirma un conteo que no tenemos', () => {
      Object.assign(search, estadoDeQuery({ isError: true }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText(/home:feedCount/)).toBeNull();
      expect(queryByText(/home:resultsUnknown/)).toBeTruthy();
    });

    it('sin conexión lo dice como falta de red, no como error del servidor', () => {
      Object.assign(search, estadoDeQuery({ isPaused: true }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText(/common:offlineTitle/)).toBeTruthy();
      expect(queryByText(/common:offlineBody/)).toBeTruthy();
      expect(queryByText(/common:loadErrorTitle/)).toBeNull();
      expect(queryByText(/home:emptyFeedText/)).toBeNull();
    });
  });

  // ── La otra mitad: lo que NO tiene que cambiar ────────────────────────
  //
  // Sin estas dos, las de arriba se satisfacen borrando el estado vacío y
  // mostrando el error siempre. Ahí el bug quedaría dado vuelta en vez de
  // arreglado, y ningún assert negativo lo notaría.
  describe('cuando sí pudimos leer', () => {
    it('una lista vacía de verdad sigue diciendo que no hay mascotas en búsqueda', () => {
      Object.assign(search, estadoDeQuery({ data: { data: [], total: 0 } }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText(/home:emptyFeedTitle/)).toBeTruthy();
      expect(queryByText(/common:loadErrorTitle/)).toBeNull();
      expect(queryByText(/home:feedCount/)).toBeTruthy();
    });

    it('con datos, se ven las mascotas', () => {
      Object.assign(search, estadoDeQuery({ data: { data: [mascota('Rex')], total: 1 } }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText('pet:Rex')).toBeTruthy();
      expect(queryByText(/home:emptyFeedTitle/)).toBeNull();
    });

    // Deslizar para refrescar es el otro camino, fuera de `ListState`: antes
    // sólo refrescaba el modo cercanía.
    it('deslizar para refrescar vuelve a pedir la búsqueda', () => {
      Object.assign(search, estadoDeQuery({ data: { data: [mascota('Rex')], total: 1 } }));

      const { UNSAFE_getByType } = render(<HomeScreen />);
      expect(refetch).not.toHaveBeenCalled();
      act(() => {
        UNSAFE_getByType(RefreshControl).props.onRefresh();
      });

      expect(refetch).toHaveBeenCalled();
    });

    // La lista está en pantalla: si la respuesta no trae `total`, el conteo
    // sale de lo que se ve, no de "no sabemos".
    it('sin total en la respuesta, cuenta lo que se ve', () => {
      Object.assign(search, estadoDeQuery({ data: { data: [mascota('Rex')] } }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText(/home:feedCount/)).toBeTruthy();
      expect(queryByText(/home:resultsUnknown/)).toBeNull();
    });

    // React Query CONSERVA lo cacheado cuando falla un refetch. Con `isError` a
    // secas —sin mirar si hay datos— un cold start de Render le BORRARÍA al
    // usuario la lista que ya estaba en pantalla y la reemplazaría por un
    // cartel. Mostrar datos viejos avisando es mejor que borrar los buenos.
    it('un refetch fallido conserva la lista y sólo avisa', () => {
      Object.assign(search, estadoDeQuery({ data: { data: [mascota('Rex')], total: 1 }, isError: true }));

      const { queryByText } = render(<HomeScreen />);

      expect(queryByText('pet:Rex')).toBeTruthy();
      expect(queryByText(/common:staleTitle/)).toBeTruthy();
      expect(queryByText(/common:loadErrorTitle/)).toBeNull();
    });
  });
});
const TYPE_ICONS = ['dog', 'cat', 'bird', 'pets'];
const ICONS_OF_TYPES = (ui: Parameters<typeof drawnIcons>[0]) => drawnIcons(ui).filter((n) => TYPE_ICONS.includes(n));
const TYPE_EMOJI = /[🐾🐕🐱🐦]/u;

describe('HomeScreen — type chips draw icons', () => {
  it('the all chip and each type draw their own icon, no emoji', () => {
    Object.assign(search, estadoDeQuery({ data: { data: [], total: 0 } }));
    const ui = render(<HomeScreen />);
    expect(ICONS_OF_TYPES(ui)).toEqual(['pets', 'dog', 'cat', 'bird', 'pets']);
    const texts = ui.UNSAFE_getAllByType(Text).map((t) => [t.props.children].flat(Infinity).join(''));
    expect(texts.filter((s) => TYPE_EMOJI.test(s))).toEqual([]);
  });

  it('the selected chip tints its icon white and the others stay secondary (both halves)', () => {
    Object.assign(search, estadoDeQuery({ data: { data: [], total: 0 } }));
    const ui = render(<HomeScreen />);
    fireEvent.press(ui.getByText('pets:types.pajaro'));
    expect(fillsOf(ui, 'bird')).toEqual([COLORS.white]);
    expect(fillsOf(ui, 'dog')).toEqual([COLORS.textSecondary]);
    expect(fillsOf(ui, 'cat')).toEqual([COLORS.textSecondary]);
  });
});
