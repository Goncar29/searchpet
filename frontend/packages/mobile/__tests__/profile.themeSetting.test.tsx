// S1: the profile Settings row chooses the theme (System / Light / Dark).
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ProfileScreen from '../app/(tabs)/profile';
import { THEME_KEY, useThemeStore } from '../store/theme';

// expo-router is mocked globally in jest.setup.js

// The screen reads the saved language on mount. The real module needs a native
// module that does not exist under jest.
// AsyncStorage comes from the global in-memory mock in jest.setup.js.

jest.mock('../store', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1', name: 'Carlos', email: 'carlos@example.com' },
    isAuthenticated: true,
    logout: jest.fn(),
  }),
  useLanguageStore: (selector: any) => selector({ setLanguage: jest.fn() }),
}));

const mockSendEmailOTP = { mutateAsync: jest.fn(), isPending: false };

// The screen imports via '../../../shared/hooks'; from this test the same module
// resolves as '../../shared/hooks'.
jest.mock('../../shared/hooks', () => ({
  useMyPets: () => ({ data: [] }),
  usePublicProfile: () => ({ data: null }),
  useUploadProfilePhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useVerificationStatus: () => ({ data: { is_verified: false }, error: null }),
  useSendEmailOTP: () => mockSendEmailOTP,
  useConfirmEmailOTP: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// i18next's t is mocked to echo the key, so error codes must resolve to
// something distinct: getErrorMessage reads "key returned unchanged" as "no
// translation" and falls back to unknown_error, which would collapse every code
// into the same string and assert nothing about which limit was hit.
// No __esModule: the CJS interop makes this object serve as both the namespace
// and the default export, which is how the screen imports it. `use`/`init` must
// chain because the screen pulls LANG_KEY from ../../i18n, and that module
// bootstraps i18next at import time.
jest.mock('i18next', () => {
  const instance: any = {
    t: (key: string) => (key.startsWith('errors:') ? `T(${key})` : key),
    use: () => instance,
    init: () => Promise.resolve(),
    changeLanguage: () => Promise.resolve(),
    language: 'es',
  };
  return instance;
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'seconds' in opts ? `${key}:${opts.seconds}` : key,
  }),
}));

jest.setTimeout(25000);

type AlertButton = { text?: string; style?: string; onPress?: () => void };

function openThemePicker(): AlertButton[] {
  render(<ProfileScreen />);
  fireEvent.press(screen.getByText('menuSettings'));
  const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'profile:themeTitle');
  if (!call) throw new Error('Settings did not open the theme picker');
  return call[2] as AlertButton[];
}

describe('ProfileScreen — Settings chooses the theme', () => {
  beforeEach(async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await AsyncStorage.clear();
    useThemeStore.setState({ preference: 'system', userChose: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('offers System, Light and Dark, plus cancel', () => {
    const buttons = openThemePicker();
    expect(buttons.map((b) => b.text)).toEqual([
      'profile:themeSystem',
      'profile:themeLight',
      'profile:themeDark',
      'common:cancel',
    ]);
  });

  it('choosing Dark applies it and saves it', async () => {
    const buttons = openThemePicker();
    await buttons.find((b) => b.text === 'profile:themeDark')!.onPress!();
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(await AsyncStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('choosing System goes back to following the phone', async () => {
    useThemeStore.setState({ preference: 'dark', userChose: false });
    const buttons = openThemePicker();
    await buttons.find((b) => b.text === 'profile:themeSystem')!.onPress!();
    expect(useThemeStore.getState().preference).toBe('system');
    expect(await AsyncStorage.getItem(THEME_KEY)).toBe('system');
  });
});
