// Home/Feed screen smoke test
import React from 'react';
import { render } from '@testing-library/react-native';
import HomeScreen from '../app/(tabs)/index';

// expo-router is mocked in jest.setup.js

jest.mock('../store', () => ({
  useAuthStore: (selector) => {
    const state = {
      login: jest.fn(),
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
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
  useSearchPets: () => ({ data: [], isLoading: false }),
  useStories: () => ({ data: [], isLoading: false }),
  useImageClassify: () => ({ classify: jest.fn(), isModelLoading: false, isClassifying: false, error: null }),
  useImageSearchNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// expo-location is mocked via moduleNameMapper → __mocks__/expo-location.js

jest.mock('../components/PetCard', () => ({
  PetCard: () => null,
}));

describe('HomeScreen (Feed)', () => {
  it('renderiza sin lanzar errores', () => {
    const { toJSON } = render(<HomeScreen />);
    expect(toJSON()).toBeTruthy();
  });
});
