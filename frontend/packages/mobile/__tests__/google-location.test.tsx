// Location step shown once after creating an account with Google
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { apiClient } from '../../shared/api/client';
import GoogleLocationScreen from '../app/google-location';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace, navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));

beforeEach(() => {
  jest.clearAllMocks();
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: -34.9011, longitude: -56.1645 },
  });
});

test('sends the coordinates when permission is granted', async () => {
  (apiClient.updateMyLocation as jest.Mock).mockResolvedValue({});

  const { getByTestId } = render(<GoogleLocationScreen />);
  fireEvent.press(getByTestId('use-my-location'));

  await waitFor(() =>
    expect(apiClient.updateMyLocation).toHaveBeenCalledWith({
      latitude: -34.9011,
      longitude: -56.1645,
    }),
  );
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
});

test('skipping does not call the api', async () => {
  const { getByTestId } = render(<GoogleLocationScreen />);
  fireEvent.press(getByTestId('skip-location'));

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(apiClient.updateMyLocation).not.toHaveBeenCalled();
});

// Negar el permiso es una decisión válida. Nunca puede dejar al usuario trabado
// en esta pantalla: la ubicación se puede cargar después desde el perfil.
test('a denied permission still lets the user into the app', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

  const { getByTestId } = render(<GoogleLocationScreen />);
  fireEvent.press(getByTestId('use-my-location'));

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(apiClient.updateMyLocation).not.toHaveBeenCalled();
});

// Si el PATCH falla, tampoco puede trabar el alta.
test('an api failure does not trap the user', async () => {
  (apiClient.updateMyLocation as jest.Mock).mockRejectedValue(new Error('500'));

  const { getByTestId } = render(<GoogleLocationScreen />);
  fireEvent.press(getByTestId('use-my-location'));

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
});
