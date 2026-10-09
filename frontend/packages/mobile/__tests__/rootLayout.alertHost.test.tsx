// Every screen raises its notices with showAlert, and only AlertHost draws
// them. Screen tests spy on showAlert, so none of them would notice the host
// missing from the root layout: every alert of the app would vanish silently.
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showAlert, resetAlerts } from '../components/appAlert';

jest.mock('../utils/notifications', () => ({ configureNotificationHandler: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

let stackRendered = false;
jest.mock('expo-router', () => {
  const Stack = ({ children }: { children?: React.ReactNode }) => {
    stackRendered = true;
    return children;
  };
  Stack.Screen = () => null;
  return { Stack, useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) };
});

import RootLayout from '../app/_layout';

describe('RootLayout mounts AlertHost', () => {
  beforeEach(async () => {
    stackRendered = false;
    await AsyncStorage.clear();
    resetAlerts();
  });

  it('an alert raised anywhere in the app is drawn', async () => {
    render(<RootLayout />);
    await waitFor(() => expect(stackRendered).toBe(true));
    act(() => showAlert('Denuncia enviada', 'Gracias por avisar'));
    expect(screen.getByText('Denuncia enviada')).toBeTruthy();
    expect(screen.getByText('Gracias por avisar')).toBeTruthy();
  });
});
