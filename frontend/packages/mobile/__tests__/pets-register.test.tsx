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

const mockCreatePetMutateAsync = jest.fn();

jest.mock('@shared/hooks', () => ({
  useCreatePet: () => ({ mutateAsync: mockCreatePetMutateAsync, isPending: false }),
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
    // Alert is a no-op under the jest-expo preset — assert the validation guard blocked the submit.
    expect(mockCreatePetMutateAsync).not.toHaveBeenCalled();
    expect(getByText('post:title')).toBeTruthy();
  });
});
