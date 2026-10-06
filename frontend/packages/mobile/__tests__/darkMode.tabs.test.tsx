// S3 / S6: the home feed follows the theme. Dark paints the page and the
// raised surfaces with the dark palette; Light keeps exactly today's colors.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import HomeScreen from '../app/(tabs)/index';
import { DARK_COLORS, LIGHT_COLORS } from '../constants';
import { useThemeStore } from '../store/theme';

// expo-router and react-i18next are mocked in jest.setup.js

jest.mock('../store', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { user: null, token: null, isAuthenticated: false, isLoading: false };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@shared/hooks', () => ({
  useSearchPets: () => ({
    data: { data: [], total: 0 },
    isLoading: false,
    isPending: false,
    isPaused: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
  useStories: () => ({ data: [], isLoading: false }),
  useImageClassify: () => ({ classify: jest.fn(), isModelLoading: false, isClassifying: false, error: null }),
  useImageSearchNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

function paint(preference: 'light' | 'dark') {
  useThemeStore.setState({ preference, userChose: true });
  const tree = render(<HomeScreen />).toJSON() as any;
  const root = StyleSheet.flatten(tree.props.style);
  // The filter bar is the first child: a raised surface over the page.
  const filterBar = StyleSheet.flatten(tree.children[0].props.style);
  return { root, filterBar };
}

describe('HomeScreen follows the theme', () => {
  afterEach(() => {
    useThemeStore.setState({ preference: 'system', userChose: false });
  });

  it('Dark paints the page and the filter bar with the dark palette', () => {
    const { root, filterBar } = paint('dark');
    expect(root.backgroundColor).toBe(DARK_COLORS.background);
    expect([DARK_COLORS.surface, DARK_COLORS.card]).toContain(filterBar.backgroundColor);
    expect(filterBar.borderBottomColor).toBe(DARK_COLORS.border);
  });

  it('Light keeps exactly today\'s colors', () => {
    const { root, filterBar } = paint('light');
    expect(root.backgroundColor).toBe(LIGHT_COLORS.background);
    expect(filterBar.backgroundColor).toBe('#FFFFFF');
    expect(filterBar.borderBottomColor).toBe(LIGHT_COLORS.border);
  });
});
