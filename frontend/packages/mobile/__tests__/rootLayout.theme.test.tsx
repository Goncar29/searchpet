// S3: the root layout paints the status bar, the header and the screen
// background from the active theme, after reading the saved choice (S2).
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DARK_COLORS, LIGHT_COLORS } from '../constants';
import { THEME_KEY, useThemeStore } from '../store/theme';

jest.mock('../utils/notifications', () => ({ configureNotificationHandler: jest.fn() }));

let statusBarStyle: string | undefined;
jest.mock('expo-status-bar', () => ({
  StatusBar: ({ style }: { style?: string }) => {
    statusBarStyle = style;
    return null;
  },
}));

let screenOptions: any;
jest.mock('expo-router', () => {
  const Stack = ({ screenOptions: opts, children }: { screenOptions?: any; children?: React.ReactNode }) => {
    screenOptions = opts;
    return children;
  };
  Stack.Screen = () => null;
  return { Stack, useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) };
});

import RootLayout from '../app/_layout';

describe('RootLayout follows the theme', () => {
  beforeEach(async () => {
    statusBarStyle = undefined;
    screenOptions = undefined;
    await AsyncStorage.clear();
    useThemeStore.setState({ preference: 'system', userChose: false });
  });

  it('a saved Dark choice paints dark from the first frame', async () => {
    await AsyncStorage.setItem(THEME_KEY, 'dark');
    render(<RootLayout />);
    await waitFor(() => expect(screenOptions).toBeDefined());

    expect(statusBarStyle).toBe('light');
    expect(screenOptions.headerStyle.backgroundColor).toBe(DARK_COLORS.surface);
    expect(screenOptions.contentStyle.backgroundColor).toBe(DARK_COLORS.background);
  });

  it('a saved Light choice paints exactly as before dark mode existed', async () => {
    await AsyncStorage.setItem(THEME_KEY, 'light');
    render(<RootLayout />);
    await waitFor(() => expect(screenOptions).toBeDefined());

    expect(statusBarStyle).toBe('dark');
    expect(screenOptions.headerStyle.backgroundColor).toBe(LIGHT_COLORS.white);
    expect(screenOptions.contentStyle.backgroundColor).toBe(LIGHT_COLORS.background);
    expect(screenOptions.headerTintColor).toBe(LIGHT_COLORS.primary);
  });
});
