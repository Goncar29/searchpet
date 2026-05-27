// Post (Create Pet) screen smoke test
import React from 'react';
import { render } from '@testing-library/react-native';
import PostScreen from '../app/(tabs)/post';

// expo-router is mocked in jest.setup.js
// expo-location and expo-image-picker are mocked via moduleNameMapper

jest.mock('../store', () => ({
  useAuthStore: (selector) => {
    const state = {
      user: { id: 'user-1', name: 'Carlos' },
      token: 'jwt-token',
      isAuthenticated: true,
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
  useCreatePet: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useCreateReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

describe('PostScreen (Crear mascota)', () => {
  it('renderiza sin lanzar errores', () => {
    const { toJSON } = render(<PostScreen />);
    expect(toJSON()).toBeTruthy();
  });
});
