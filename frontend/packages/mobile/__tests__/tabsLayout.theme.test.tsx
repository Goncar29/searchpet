// S3: the tab bar and header follow the theme, and System resolves through the
// phone's scheme (useColorScheme) — the real wiring, not just resolveScheme.
import React from 'react';
import { render } from '@testing-library/react-native';
import { DARK_COLORS, LIGHT_COLORS } from '../constants';
import { useThemeStore } from '../store/theme';

let mockPhoneScheme: 'light' | 'dark' | null = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockPhoneScheme,
}));

let mockTabOptions: any;
jest.mock('expo-router', () => {
  const Tabs = ({ screenOptions, children }: { screenOptions?: any; children?: React.ReactNode }) => {
    mockTabOptions = screenOptions;
    return children;
  };
  Tabs.Screen = () => null;
  return { Tabs };
});

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('../store', () => ({ useAuthStore: (sel: any) => sel({ isAuthenticated: false }) }));
jest.mock('@shared/hooks', () => ({ useUnreadCount: () => ({ data: undefined }) }));

import TabsLayout from '../app/(tabs)/_layout';

describe('TabsLayout follows the theme', () => {
  beforeEach(() => {
    mockTabOptions = undefined;
    useThemeStore.setState({ preference: 'system', userChose: false });
  });

  it('System on a dark phone paints the tab bar and header dark', () => {
    mockPhoneScheme = 'dark';
    render(<TabsLayout />);
    expect(mockTabOptions.tabBarStyle.backgroundColor).toBe(DARK_COLORS.surface);
    expect(mockTabOptions.tabBarStyle.borderTopColor).toBe(DARK_COLORS.border);
    expect(mockTabOptions.headerStyle.backgroundColor).toBe(DARK_COLORS.surface);
    expect(mockTabOptions.headerTintColor).toBe(DARK_COLORS.textPrimary);
  });

  it('System on a light phone paints exactly as before', () => {
    mockPhoneScheme = 'light';
    render(<TabsLayout />);
    expect(mockTabOptions.tabBarStyle.backgroundColor).toBe(LIGHT_COLORS.white);
    expect(mockTabOptions.headerTintColor).toBe(LIGHT_COLORS.textPrimary);
    expect(mockTabOptions.tabBarInactiveTintColor).toBe(LIGHT_COLORS.textMuted);
  });

  it('Light overrides a dark phone', () => {
    mockPhoneScheme = 'dark';
    useThemeStore.setState({ preference: 'light', userChose: true });
    render(<TabsLayout />);
    expect(mockTabOptions.tabBarStyle.backgroundColor).toBe(LIGHT_COLORS.surface);
  });
});
