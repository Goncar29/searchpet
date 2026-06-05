// Map screen tests — createCircleGeoJSON unit tests + MapScreen smoke test
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { createCircleGeoJSON } from '../app/(tabs)/map';

// Mock @maplibre/maplibre-react-native — native module not available in Jest
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = (props) => React.createElement(View, { testID: 'map-view', ...props });
  const MockCamera = React.forwardRef((props, _ref) => React.createElement(View, props));
  const MockShapeSource = (props) => React.createElement(View, props);
  const MockFillLayer = () => null;
  const MockLineLayer = () => null;
  const MockUserLocation = () => null;
  const MockPointAnnotation = (props) => React.createElement(View, props);
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
  useAuthStore: (selector) => {
    const state = {
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      login: jest.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@shared/hooks', () => ({
  useNearbyReports: () => ({ data: [], isLoading: false }),
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
});
