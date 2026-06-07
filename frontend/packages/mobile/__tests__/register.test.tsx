import React from 'react';
import { render, screen } from '@testing-library/react-native';
import RegisterScreen from '../app/register';

// expo-router is mocked in jest.setup.js

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es', changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

jest.mock('../store', () => ({
  useAuthStore: (selector) => {
    const state = {
      login: jest.fn(),
      register: jest.fn(),
      logout: jest.fn(),
      loadToken: jest.fn(),
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: () => ({ latitude: null, longitude: null, setLocation: jest.fn() }),
}));

describe('RegisterScreen', () => {
  it('renderiza el formulario de registro sin errores', () => {
    render(<RegisterScreen />);
    expect(screen.getByPlaceholderText('register.emailPlaceholder')).toBeTruthy();
  });

  it('muestra el botón de crear cuenta', () => {
    render(<RegisterScreen />);
    expect(screen.getAllByText('register.submit').length).toBeGreaterThan(0);
  });
});
