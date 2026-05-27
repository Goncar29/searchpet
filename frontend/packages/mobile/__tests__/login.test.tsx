import React from 'react';
import { render, screen } from '@testing-library/react-native';
import LoginScreen from '../app/login';

// expo-router is mocked in jest.setup.js

// Zustand auth store mock
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

describe('LoginScreen', () => {
  it('renderiza el formulario de login sin errores', () => {
    render(<LoginScreen />);
    expect(screen.getByPlaceholderText('Email')).toBeTruthy();
  });

  it('muestra el botón de iniciar sesión', () => {
    render(<LoginScreen />);
    expect(screen.getByText('Iniciar Sesión')).toBeTruthy();
  });
});
