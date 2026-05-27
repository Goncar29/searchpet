import React from 'react';
import { render, screen } from '@testing-library/react-native';
import RegisterScreen from '../app/register';

// expo-router is mocked in jest.setup.js

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
    expect(screen.getByPlaceholderText('tu@email.com')).toBeTruthy();
  });

  it('muestra el botón de crear cuenta', () => {
    render(<RegisterScreen />);
    // getAllByText because "Crear Cuenta" may appear in both title and button
    expect(screen.getAllByText('Crear Cuenta').length).toBeGreaterThan(0);
  });
});
