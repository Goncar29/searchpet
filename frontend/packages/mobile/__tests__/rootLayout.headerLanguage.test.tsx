// The Stack header titles are read in RootLayout's render. If RootLayout does not
// subscribe to the language (useTranslation), a language that arrives after the
// first render (the saved choice is read from AsyncStorage asynchronously) or a
// later switch leaves every native header frozen in the first language.
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import i18n from '../i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../utils/notifications', () => ({ configureNotificationHandler: jest.fn() }));

const captured: Record<string, string> = {};
jest.mock('expo-router', () => {
  const Stack = ({ children }: { children?: React.ReactNode }) => children;
  Stack.Screen = ({ name, options }: { name: string; options?: { title?: string } }) => {
    if (options?.title !== undefined) captured[name] = options.title;
    return null;
  };
  return {
    Stack,
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  };
});

import RootLayout from '../app/_layout';

describe('RootLayout header titles follow the language', () => {
  afterAll(async () => {
    await act(async () => {
      await i18n.changeLanguage('es');
    });
  });

  it('re-renders the native titles when the language changes', async () => {
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    // The layout paints after the saved theme is read (async), so let that
    // settle before reading the titles.
    render(<RootLayout />);
    await waitFor(() => expect(captured['my-pets']).toBeDefined());
    const es = captured['my-pets'];
    expect(es).toBe(i18n.t('my_pets:title', { lng: 'es' }));

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(captured['my-pets']).toBe(i18n.t('my_pets:title', { lng: 'en' }));
    expect(captured['my-pets']).not.toBe(es);

    await act(async () => {
      await i18n.changeLanguage('pt');
    });
    expect(captured['my-pets']).toBe(i18n.t('my_pets:title', { lng: 'pt' }));
  });
});
