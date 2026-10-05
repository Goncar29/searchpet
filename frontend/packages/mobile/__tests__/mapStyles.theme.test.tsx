// S5: every map follows dark mode. The URLs come from one module; the open
// maps (publish location step, sighting timeline) use OpenFreeMap's `dark`.
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { mainMapStyle, openMapStyle } from '../constants/mapStyles';
import { useThemeStore } from '../store/theme';

jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = (props: Record<string, unknown>) => React.createElement(View, { testID: 'map-view', ...props });
  const Pass = (props: Record<string, unknown>) => React.createElement(View, props);
  const Camera = React.forwardRef((props: Record<string, unknown>, _ref: unknown) => React.createElement(View, props));
  const api = { MapView: MockMapView, Camera, PointAnnotation: Pass, ShapeSource: Pass, LineLayer: () => null, UserLocation: () => null, setAccessToken: jest.fn() };
  return { __esModule: true, default: api, ...api };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { LocationStep } from '../components/publish/LocationStep';

describe('map style URLs', () => {
  it('main map: MapTiler streets-v4, with its dark variant', () => {
    expect(mainMapStyle('light')).toMatch(/\/maps\/streets-v4\/style\.json\?key=/);
    expect(mainMapStyle('dark')).toMatch(/\/maps\/streets-v4-dark\/style\.json\?key=/);
  });

  it('open maps: OpenFreeMap liberty, with dark', () => {
    expect(openMapStyle('light')).toBe('https://tiles.openfreemap.org/styles/liberty');
    expect(openMapStyle('dark')).toBe('https://tiles.openfreemap.org/styles/dark');
  });
});

describe('publish location map follows the theme', () => {
  afterEach(() => useThemeStore.setState({ preference: 'system', userChose: false }));

  const renderStep = () =>
    render(<LocationStep value={null} onPublish={jest.fn()} onBack={jest.fn()} isPending={false} />);

  it('dark mode loads the dark OpenFreeMap style', () => {
    useThemeStore.setState({ preference: 'dark', userChose: true });
    renderStep();
    expect(screen.getByTestId('map-view').props.mapStyle).toBe(openMapStyle('dark'));
  });

  it('light mode keeps liberty, as before', () => {
    useThemeStore.setState({ preference: 'light', userChose: true });
    renderStep();
    expect(screen.getByTestId('map-view').props.mapStyle).toBe(openMapStyle('light'));
  });
});
