// Post (Publish wizard) screen smoke test
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import PostScreen from '../app/(tabs)/post';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es', changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

jest.mock('../store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    const state = {
      user: { id: 'user-1', name: 'Carlos' },
      token: 'jwt-token',
      isAuthenticated: true,
      isLoading: false,
      login: jest.fn(),
      register: jest.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector: (state: unknown) => unknown) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@shared/hooks', () => ({
  useMyPets: () => ({ data: [], isLoading: false }),
  usePublishLost: () => ({ mutateAsync: jest.fn(), isPending: false }),
  usePublishStrayNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

describe('PostScreen (Publish wizard)', () => {
  it('renders the intent step first', () => {
    const { getByText } = render(<PostScreen />);
    expect(getByText('publish:intent.lostTitle')).toBeTruthy();
    expect(getByText('publish:intent.strayTitle')).toBeTruthy();
  });

  it('selecting the lost intent advances to the lost-pet step', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    expect(getByText('publish:lostPet.title')).toBeTruthy();
  });

  it('selecting the stray intent advances to the stray-form step', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.strayTitle'));
    expect(getByText('publish:strayForm.title')).toBeTruthy();
  });
});
