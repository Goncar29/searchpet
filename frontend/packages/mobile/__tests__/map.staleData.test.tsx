// Map screen — what the reports counter shows when `useNearbyReports` fails.
//
// Rule #60: a failed query must never render like an empty list/count. The
// map itself stays visible either way (it's not wrapped by ListState — a
// failed query cannot hide the whole map), but the counter widget is the
// only place on this screen that would otherwise silently say "0 reports
// nearby" while the request actually failed.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

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

jest.mock('../store', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { user: null, token: null, isAuthenticated: false, isLoading: false, login: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// Loosely typed on purpose: the tests below hand back several different
// query shapes (no data + error, no data + paused, cached data + error...)
// via `mockReturnValue`, and a return type inferred from the default value
// alone would reject all but the first.
type MockedQuery = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  isPaused?: boolean;
  refetch?: () => void;
};
const mockUseNearbyReports = jest.fn((..._args: unknown[]): MockedQuery => ({ data: [], isLoading: false }));
const mockUseNearbyVets = jest.fn((..._args: unknown[]): MockedQuery => ({ data: [], isLoading: false }));

jest.mock('@shared/hooks', () => ({
  useNearbyReports: (...args: unknown[]) => mockUseNearbyReports(...args),
  useNearbyVets: (...args: unknown[]) => mockUseNearbyVets(...args),
}));

// Keys render literally (no i18next instance in these tests), which is what
// lets these assertions tell the error-copy apart from the count copy.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('i18next', () => ({
  t: (key: string) => key,
}));

import MapScreen from '../app/(tabs)/map';

const report = {
  id: 'r-1',
  status: 'lost',
  latitude: -34.9011,
  longitude: -56.1645,
  pet: { id: 'pet-1', name: 'Firulais' },
};

describe('MapScreen — el contador de reportes no afirma "0" cuando la consulta falló', () => {
  it('sin caché y con error, muestra el estado de error con reintentar, no el conteo', () => {
    const refetch = jest.fn();
    mockUseNearbyReports.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isPaused: false,
      refetch,
    });

    render(<MapScreen />);

    expect(screen.getByText('common:loadErrorTitle')).toBeTruthy();
    expect(screen.getByText('common:retry')).toBeTruthy();
    expect(screen.queryByText('counter')).toBeNull();

    fireEvent.press(screen.getByText('common:retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('sin caché y offline (isPaused), muestra el estado offline y no el conteo', () => {
    mockUseNearbyReports.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isPaused: true,
      refetch: jest.fn(),
    });

    render(<MapScreen />);

    expect(screen.getByText('common:offlineTitle')).toBeTruthy();
    expect(screen.queryByText('common:loadErrorTitle')).toBeNull();
    expect(screen.queryByText('counter')).toBeNull();
  });

  it('con reportes cacheados y un refetch fallido, el contador sigue correcto y aparece la franja', () => {
    mockUseNearbyReports.mockReturnValue({
      data: [report],
      isLoading: false,
      isError: true,
      isPaused: false,
      refetch: jest.fn(),
    });

    render(<MapScreen />);

    // The count text is still rendered from real cached data.
    expect(screen.getByText('counter')).toBeTruthy();
    // It is not the error state — the map/counter are not lying about it.
    expect(screen.queryByText('common:loadErrorTitle')).toBeNull();
    // But the user is told the refetch failed.
    expect(screen.getByText('common:staleTitle')).toBeTruthy();
  });

  it('con reportes cacheados y offline (isPaused), el contador sigue correcto y aparece la franja offline', () => {
    mockUseNearbyReports.mockReturnValue({
      data: [report],
      isLoading: false,
      isError: false,
      isPaused: true,
      refetch: jest.fn(),
    });

    render(<MapScreen />);

    // The count text is still rendered from real cached data.
    expect(screen.getByText('counter')).toBeTruthy();
    // It is not the no-cache error state.
    expect(screen.queryByText('common:loadErrorTitle')).toBeNull();
    // StaleDataNotice checks `isPaused` before `isError` (see ListState.tsx):
    // offline shows `common:offlineStale`, never the generic `common:staleTitle`.
    expect(screen.getByText('common:offlineStale')).toBeTruthy();
    expect(screen.queryByText('common:staleTitle')).toBeNull();
  });

  it('sin fallas, muestra el conteo normal y ninguna franja', () => {
    mockUseNearbyReports.mockReturnValue({
      data: [report],
      isLoading: false,
      isError: false,
      isPaused: false,
      refetch: jest.fn(),
    });

    render(<MapScreen />);

    expect(screen.getByText('counter')).toBeTruthy();
    expect(screen.queryByText('common:loadErrorTitle')).toBeNull();
    expect(screen.queryByText('common:staleTitle')).toBeNull();
  });
});
