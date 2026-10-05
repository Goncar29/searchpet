// S3 + S6: the account, alerts, community and story screens follow the theme.
// Dark paints the dark palette; light keeps exactly today's values.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { DARK_COLORS, LIGHT_COLORS } from '../constants';
import { useThemeStore } from '../store/theme';
import LoginScreen from '../app/login';

// expo-router is mocked in jest.setup.js

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es', changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

jest.mock('../store', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      login: jest.fn(),
      loginWithGoogle: jest.fn(),
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

function rootBackground(): string | undefined {
  // The KeyboardAvoidingView root is the first host view rendered.
  const json = screen.toJSON() as any;
  const root = Array.isArray(json) ? json[0] : json;
  return StyleSheet.flatten(root.props.style)?.backgroundColor;
}

describe('login screen follows the theme', () => {
  afterEach(() => {
    useThemeStore.setState({ preference: 'system', userChose: false });
  });

  it('dark paints the page and the inputs with the dark palette', () => {
    useThemeStore.setState({ preference: 'dark', userChose: true });
    render(<LoginScreen />);
    expect(rootBackground()).toBe(DARK_COLORS.background);
    const input = screen.getByPlaceholderText('login.email');
    const style = StyleSheet.flatten(input.props.style);
    expect(style.backgroundColor).toBe(DARK_COLORS.surface);
    expect(style.color).toBe(DARK_COLORS.textPrimary);
    expect(input.props.placeholderTextColor).toBe(DARK_COLORS.placeholder);
  });

  it('light keeps the values the screen had before dark mode', () => {
    useThemeStore.setState({ preference: 'light', userChose: true });
    render(<LoginScreen />);
    expect(rootBackground()).toBe('#F8F9FA');
    const input = screen.getByPlaceholderText('login.email');
    const style = StyleSheet.flatten(input.props.style);
    expect(style.backgroundColor).toBe('#FFFFFF');
    expect(style.color).toBe(LIGHT_COLORS.textPrimary);
    expect(input.props.placeholderTextColor).toBe('#D1D5DB');
  });
});
