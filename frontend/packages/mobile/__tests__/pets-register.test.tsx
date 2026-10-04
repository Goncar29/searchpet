// Pet registration screen smoke test (extracted from the old post.tsx)
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import RegisterPetScreen from '../app/pets/register';
import { drawnIcons, fillsOf } from './support/icons';
import { COLORS } from '../constants';

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
    expect(getByText('post:nameLabel')).toBeTruthy();
  });
});
const TYPE_ICONS = ['dog', 'cat', 'bird', 'pets'];
const ICONS_OF_TYPES = (ui: Parameters<typeof drawnIcons>[0]) => drawnIcons(ui).filter((n) => TYPE_ICONS.includes(n));
const TYPE_EMOJI = /[🐾🐕🐱🐦]/u;

describe('RegisterPetScreen — type buttons draw icons', () => {
  it('each type draws its own icon, no emoji', () => {
    const ui = render(<RegisterPetScreen />);
    expect(ICONS_OF_TYPES(ui)).toEqual(['dog', 'cat', 'bird', 'pets']);
    const texts = ui
      .UNSAFE_getAllByType(require('react-native').Text)
      .map((t: any) => [t.props.children].flat(Infinity).join(''));
    expect(texts.filter((s: string) => TYPE_EMOJI.test(s))).toEqual([]);
  });

  it('the selected type is primary and the others secondary (both halves)', () => {
    const ui = render(<RegisterPetScreen />);
    fireEvent.press(ui.getByText('pets:types.gato'));
    expect(fillsOf(ui, 'cat')).toEqual([COLORS.primary]);
    expect(fillsOf(ui, 'dog')).toEqual([COLORS.textSecondary]);
  });
});
