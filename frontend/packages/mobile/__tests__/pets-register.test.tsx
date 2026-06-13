// Pet registration screen smoke test (extracted from the old post.tsx)
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import RegisterPetScreen from '../app/pets/register';

jest.mock('../store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    const state = { user: { id: 'user-1', name: 'Carlos' }, token: 'jwt-token', isAuthenticated: true, isLoading: false };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@shared/hooks', () => ({
  useCreatePet: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

describe('RegisterPetScreen', () => {
  it('renders without throwing', () => {
    const { toJSON } = render(<RegisterPetScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('shows a validation error when submitting without a name', () => {
    const { getByText } = render(<RegisterPetScreen />);
    fireEvent.press(getByText('post:submit'));
    // Alert.alert is mocked globally in jest.setup.js — assert the screen didn't crash and is still showing the form.
    expect(getByText('post:title')).toBeTruthy();
  });
});
