// Login screen — Google sign-in wiring
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import LoginScreen from '../app/login';

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
    const state = { login: jest.fn(), loginWithGoogle: mockLoginWithGoogle };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// El botón sólo se renderiza con un client id, así que la pantalla debe pasarlo.
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

test('sends the id token to the store', async () => {
  mockLoginWithGoogle.mockResolvedValue(false);

  const { getByTestId } = render(<LoginScreen />);
  fireEvent.press(getByTestId('google-signin-button'));

  await waitFor(() => expect(mockLoginWithGoogle).toHaveBeenCalledWith('google-id-token'));
});

// Un usuario que vuelve ya tiene ubicación: mandarlo al onboarding sería
// hacerle repetir un paso que ya hizo.
test('a returning user goes straight back, not to the location step', async () => {
  mockLoginWithGoogle.mockResolvedValue(false);

  const { getByTestId } = render(<LoginScreen />);
  fireEvent.press(getByTestId('google-signin-button'));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(mockReplace).not.toHaveBeenCalled();
});

test('a brand-new account is routed to the location step', async () => {
  mockLoginWithGoogle.mockResolvedValue(true);

  const { getByTestId } = render(<LoginScreen />);
  fireEvent.press(getByTestId('google-signin-button'));

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/google-location'));
});
