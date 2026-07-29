// Register screen — Google sign-in wiring
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import RegisterScreen from '../app/register';

const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: mockReplace, navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));

const mockLoginWithGoogle = jest.fn();

jest.mock('../store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => {
    const state = { register: jest.fn(), loginWithGoogle: mockLoginWithGoogle };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('../constants', () => ({
  ...jest.requireActual('../constants'),
  GOOGLE_WEB_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
}));

beforeEach(() => {
  jest.clearAllMocks();
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
    type: 'success',
    data: { idToken: 'google-id-token' },
  });
});

test('signing up with Google routes a new account to the location step', async () => {
  mockLoginWithGoogle.mockResolvedValue(true);

  const { getByTestId } = render(<RegisterScreen />);
  fireEvent.press(getByTestId('google-signin-button'));

  await waitFor(() => expect(mockLoginWithGoogle).toHaveBeenCalledWith('google-id-token'));
  expect(mockReplace).toHaveBeenCalledWith('/google-location');
});

// Entrar por "Registrarse" con una cuenta que YA existe la vincula en el backend
// y devuelve is_new_user=false. No es un error: simplemente ya está adentro.
test('an existing account reached from register just goes back', async () => {
  mockLoginWithGoogle.mockResolvedValue(false);

  const { getByTestId } = render(<RegisterScreen />);
  fireEvent.press(getByTestId('google-signin-button'));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(mockReplace).not.toHaveBeenCalled();
});
