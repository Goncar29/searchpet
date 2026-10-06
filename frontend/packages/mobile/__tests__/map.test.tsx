// Map screen tests — createCircleGeoJSON unit tests + MapScreen smoke test
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react-native';
import { createCircleGeoJSON } from '../app/(tabs)/map';
import { StyleSheet } from 'react-native';
import { COLORS, SPACING } from '../constants';
import { drawnIcons, emojiTexts, fillsOf } from './support/icons';

// Mock @maplibre/maplibre-react-native — native module not available in Jest
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = (props: Record<string, unknown>) => React.createElement(View, { testID: 'map-view', ...props });
  const MockCamera = React.forwardRef((props: Record<string, unknown>, _ref: unknown) => React.createElement(View, props));
  const MockShapeSource = (props: Record<string, unknown>) => React.createElement(View, props);
  const MockFillLayer = () => null;
  const MockLineLayer = () => null;
  const MockUserLocation = () => null;
  const MockPointAnnotation = (props: Record<string, unknown>) => React.createElement(View, props);
  return {
    __esModule: true,
    default: {
      MapView: MockMapView,
      Camera: MockCamera,
      ShapeSource: MockShapeSource,
      FillLayer: MockFillLayer,
      LineLayer: MockLineLayer,
      UserLocation: MockUserLocation,
      PointAnnotation: MockPointAnnotation,
      setAccessToken: jest.fn(),
    },
    MapView: MockMapView,
    Camera: MockCamera,
    ShapeSource: MockShapeSource,
    FillLayer: MockFillLayer,
    LineLayer: MockLineLayer,
    UserLocation: MockUserLocation,
    PointAnnotation: MockPointAnnotation,
    setAccessToken: jest.fn(),
  };
});

// expo-location is mocked via moduleNameMapper → __mocks__/expo-location.js
// expo-router is mocked via jest.setup.js

jest.mock('../store', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      login: jest.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// Named with the `mock` prefix so jest's hoisting allows referencing it inside the factory.
const mockUseNearbyReports = jest.fn((..._args: unknown[]): Record<string, unknown> => ({ data: [], isLoading: false }));
// Idem, y NO un jest.fn() suelto dentro del factory: asi definido, nadie puede
// leer con que argumentos se llamo, y el bug que se arreglo aca era justamente
// un argumento equivocado en el call site.
const mockUseNearbyVets = jest.fn((..._args: unknown[]) => ({ data: [], isLoading: false }));

jest.mock('@shared/hooks', () => ({
  useNearbyReports: (...args: unknown[]) => mockUseNearbyReports(...args),
  useNearbyVets: (...args: unknown[]) => mockUseNearbyVets(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('i18next', () => ({
  t: (key: string) => key,
}));

// ============================================================
// createCircleGeoJSON unit tests
// ============================================================

describe('createCircleGeoJSON', () => {
  it('returns a valid GeoJSON Feature', () => {
    const result = createCircleGeoJSON(-56.1645, -34.9011, 3);
    expect(result.type).toBe('Feature');
  });

  it('geometry.type is Polygon', () => {
    const result = createCircleGeoJSON(-56.1645, -34.9011, 3);
    expect(result.geometry.type).toBe('Polygon');
  });

  it('coordinates[0] has 65 points (64 + closing point)', () => {
    const result = createCircleGeoJSON(-56.1645, -34.9011, 3);
    expect(result.geometry.coordinates[0]).toHaveLength(65);
  });

  it('first and last coordinate are equal (ring is closed)', () => {
    const result = createCircleGeoJSON(-56.1645, -34.9011, 3);
    const ring = result.geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('center of the polygon approximates the input center', () => {
    const lng = -56.1645;
    const lat = -34.9011;
    const result = createCircleGeoJSON(lng, lat, 3);
    const ring = result.geometry.coordinates[0];

    // Average all coordinates to find approximate center
    const sumLng = ring.reduce((sum, coord) => sum + coord[0], 0);
    const sumLat = ring.reduce((sum, coord) => sum + coord[1], 0);
    const avgLng = sumLng / ring.length;
    const avgLat = sumLat / ring.length;

    // Center should be within 0.001 degrees of the input
    expect(Math.abs(avgLng - lng)).toBeLessThan(0.001);
    expect(Math.abs(avgLat - lat)).toBeLessThan(0.001);
  });
});

// ============================================================
// MapScreen smoke test
// ============================================================

import MapScreen from '../app/(tabs)/map';

describe('MapScreen', () => {
  it('renders radius buttons [1, 3, 5, 10]', () => {
    render(<MapScreen />);
    expect(screen.getByText('1km')).toBeTruthy();
    expect(screen.getByText('3km')).toBeTruthy();
    expect(screen.getByText('5km')).toBeTruthy();
    expect(screen.getByText('10km')).toBeTruthy();
  });

  // MapLibre RN 10 reads the style ONLY from `mapStyle` (MapView.tsx, the
  // `const { mapStyle, ...otherProps } = props` in render). A `styleURL` prop
  // is dropped without a warning, and the native side falls back to
  // demotiles.maplibre.org: country outlines, no streets. That shipped in
  // every APK up to v1.0.6.
  it('passes the MapTiler style through mapStyle, the prop MapLibre 10 reads', () => {
    render(<MapScreen />);
    const mapView = screen.getByTestId('map-view');
    expect(mapView.props.mapStyle).toMatch(/^https:\/\/api\.maptiler\.com\/maps\/.+\/style\.json\?key=/);
    expect(mapView.props.styleURL).toBeUndefined();
  });

  // S5: the main map follows dark mode with MapTiler's own dark variant.
  it('uses the dark MapTiler style in dark mode and the light one otherwise', () => {
    const { useThemeStore } = require('../store/theme');
    try {
      useThemeStore.setState({ preference: 'dark', userChose: true });
      const { unmount } = render(<MapScreen />);
      expect(screen.getByTestId('map-view').props.mapStyle).toContain('/maps/streets-v4-dark/');
      unmount();

      useThemeStore.setState({ preference: 'light', userChose: true });
      render(<MapScreen />);
      expect(screen.getByTestId('map-view').props.mapStyle).toContain('/maps/streets-v4/');
    } finally {
      useThemeStore.setState({ preference: 'system', userChose: false });
    }
  });

  it('shows the "search this area" button after panning beyond the threshold', () => {
    render(<MapScreen />);
    // not panned yet
    expect(screen.queryByText('searchHere')).toBeNull();

    // MapLibre onRegionDidChange feature: geometry.coordinates = [lng, lat] center
    // Pan ~5.5 km north of the default (-34.9011): lat -34.8511
    const mapView = screen.getByTestId('map-view');
    act(() => {
      mapView.props.onRegionDidChange({
        geometry: { coordinates: [-56.1645, -34.8511] },
      });
    });

    expect(screen.getByText('searchHere')).toBeTruthy();
  });

  it('pressing "search this area" re-fetches at the new center', () => {
    mockUseNearbyReports.mockClear();
    render(<MapScreen />);

    const mapView = screen.getByTestId('map-view');
    act(() => {
      mapView.props.onRegionDidChange({
        geometry: { coordinates: [-56.1645, -34.8511] },
      });
    });
    fireEvent.press(screen.getByText('searchHere'));

    const calls = mockUseNearbyReports.mock.calls as unknown[][];
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBeCloseTo(-34.8511, 3); // new search lat
  });

  // El bug arreglado era del CALL SITE: un 5000 hardcodeado que ignoraba el
  // selector. El test de shared/utils/vetLayerRadius no puede cazar eso —
  // prueba la funcion pura, no quien la llama. Sin esta asercion, re-hardcodear
  // el radio en map.tsx deja toda la suite de mobile en verde.
  it('la capa de veterinarias sigue el selector de radio', () => {
    mockUseNearbyVets.mockClear();
    render(<MapScreen />);

    fireEvent.press(screen.getByText('10km'));

    const calls = mockUseNearbyVets.mock.calls as unknown[][];
    expect(calls[calls.length - 1][2]).toBe(10_000);
  });

  it('shows the empty-state when vets are enabled but none are nearby', () => {
    render(<MapScreen />);
    // vets are off by default — no empty message yet
    expect(screen.queryByText('vetEmpty')).toBeNull();
    // enable the vets layer (useNearbyVets mock returns an empty list)
    fireEvent.press(screen.getByText('map:vetsToggle'));
    expect(screen.getByText('vetEmpty')).toBeTruthy();
  });

  it('draws the vets toggle and the center-on-me button as icons, with no emoji', () => {
    const ui = render(<MapScreen />);
    expect(drawnIcons(ui)).toEqual(expect.arrayContaining(['local-hospital', 'location-on']));
    expect(emojiTexts(ui)).toEqual([]);
    // The icon-only button carries a label for screen readers.
    expect(screen.getByLabelText('centerOnMe')).toBeTruthy();
  });

  it('tints the vets icon with the toggle state: muted when off, white when on', () => {
    const ui = render(<MapScreen />);
    expect(fillsOf(ui, 'local-hospital')).toEqual([COLORS.textSecondary]);
    fireEvent.press(screen.getByText('map:vetsToggle'));
    expect(fillsOf(ui, 'local-hospital')).toEqual([COLORS.white]);
  });
});

// ============================================================
// Bottom-anchored controls
// ============================================================

describe('MapScreen controls', () => {
  const report = {
    id: 'r1', pet_id: 'p1', status: 'lost', latitude: -34.9, longitude: -56.16,
    location_description: 'Cerca del parque', pet: { id: 'p1', name: 'Firulais' },
  };

  it('keeps radius chips, vets toggle, center button and counter in ONE container at the bottom', () => {
    render(<MapScreen />);
    const controls = screen.getByTestId('map-bottom-controls');
    const flat = StyleSheet.flatten(controls.props.style);
    expect(flat.position).toBe('absolute');
    expect(flat.bottom).toBe(SPACING.lg);
    expect(flat.left).toBe(SPACING.lg);
    expect(flat.right).toBe(SPACING.lg);

    const inside = within(controls);
    for (const km of ['1km', '3km', '5km', '10km']) expect(inside.getByText(km)).toBeTruthy();
    expect(inside.getByText('map:vetsToggle')).toBeTruthy();
    expect(inside.getByLabelText('centerOnMe')).toBeTruthy();
    expect(inside.getByText('counter')).toBeTruthy();
  });

  it('leaves no control floating with its own absolute bottom offset', () => {
    render(<MapScreen />);
    for (const label of ['centerOnMe']) {
      let node = screen.getByLabelText(label);
      // Walk up to the controls container: nothing in between may be absolute.
      while (node.props.testID !== 'map-bottom-controls') {
        expect(StyleSheet.flatten(node.props.style)?.position).not.toBe('absolute');
        node = node.parent as typeof node;
      }
    }
    for (const text of ['1km', 'map:vetsToggle', 'counter']) {
      let node = screen.getByText(text);
      while (node.props.testID !== 'map-bottom-controls') {
        expect(StyleSheet.flatten(node.props.style)?.position).not.toBe('absolute');
        node = node.parent as typeof node;
      }
    }
  });

  it('puts the selected-report card inside the container, so it can never overlap the controls', () => {
    mockUseNearbyReports.mockReturnValue({ data: [report], isLoading: false });
    render(<MapScreen />);
    act(() => {
      screen.UNSAFE_getByProps({ id: 'marker-r1' }).props.onSelected();
    });
    const inside = within(screen.getByTestId('map-bottom-controls'));
    expect(inside.getByText('Firulais')).toBeTruthy();
    expect(inside.getByText('1km')).toBeTruthy();
    mockUseNearbyReports.mockReturnValue({ data: [], isLoading: false });
  });

  it('puts the stale-data banner inside the container too', () => {
    mockUseNearbyReports.mockReturnValue({ data: [report], isLoading: false, isError: true, refetch: jest.fn() });
    render(<MapScreen />);
    const inside = within(screen.getByTestId('map-bottom-controls'));
    expect(inside.getByText('common:staleTitle')).toBeTruthy();
    mockUseNearbyReports.mockReturnValue({ data: [], isLoading: false });
  });

  it('puts the empty-vets banner inside the container', () => {
    render(<MapScreen />);
    fireEvent.press(screen.getByText('map:vetsToggle'));
    expect(within(screen.getByTestId('map-bottom-controls')).getByText('vetEmpty')).toBeTruthy();
  });
});
