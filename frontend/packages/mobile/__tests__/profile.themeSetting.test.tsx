// S1: the profile Settings row chooses the theme (System / Light / Dark), and
// the Language row the language, both in OptionPickerModal: all options at
// once, and it closes without choosing (X, outside, back button).
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ProfileScreen from '../app/(tabs)/profile';
import { THEME_KEY, useThemeStore } from '../store/theme';
import { LANG_KEY } from '../i18n';
import i18next from 'i18next';

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

describe('ProfileScreen — Settings chooses the theme', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useThemeStore.setState({ preference: 'system', userChose: false });
  });

  it('offers System, Light and Dark at once, with the current one marked', () => {
    render(<ProfileScreen />);
    fireEvent.press(screen.getByText('menuSettings'));
    expect(screen.getByText('themeTitle')).toBeTruthy();
    for (const label of ['themeSystem', 'themeLight', 'themeDark']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    }
    expect(screen.getByTestId('option-check-system')).toBeTruthy();
  });

  it('choosing Dark applies it and saves it', async () => {
    render(<ProfileScreen />);
    fireEvent.press(screen.getByText('menuSettings'));
    fireEvent.press(screen.getByText('themeDark'));
    expect(useThemeStore.getState().preference).toBe('dark');
    await waitFor(async () => expect(await AsyncStorage.getItem(THEME_KEY)).toBe('dark'));
  });

  it('closes without choosing', () => {
    render(<ProfileScreen />);
    fireEvent.press(screen.getByText('menuSettings'));
    fireEvent.press(screen.getByLabelText('common:close'));
    expect(screen.queryByText('themeTitle')).toBeNull();
    expect(useThemeStore.getState().preference).toBe('system');
  });
});

describe('ProfileScreen — Language row', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('marks the current language, even when i18next reports a regional code', () => {
    const lang = jest.replaceProperty(i18next, 'language', 'en-US');
    render(<ProfileScreen />);
    fireEvent.press(screen.getByText('menuLanguage'));
    expect(screen.getByTestId('option-check-en')).toBeTruthy();
    lang.restore();
  });

  it('a failed save still changes the language and does not reject', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    const change = jest.spyOn(i18next, 'changeLanguage');
    render(<ProfileScreen />);
    fireEvent.press(screen.getByText('menuLanguage'));
    fireEvent.press(screen.getByText('portuguese'));
    expect(change).toHaveBeenCalledWith('pt');
    await waitFor(() => expect(warn).toHaveBeenCalled());
    jest.restoreAllMocks();
  });

  it('offers the three languages at once', () => {
    render(<ProfileScreen />);
    fireEvent.press(screen.getByText('menuLanguage'));
    expect(screen.getByText('languageTitle')).toBeTruthy();
    for (const label of ['spanish', 'english', 'portuguese']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    }
  });

  it('choosing English changes and saves the language', async () => {
    const change = jest.spyOn(i18next, 'changeLanguage');
    render(<ProfileScreen />);
    fireEvent.press(screen.getByText('menuLanguage'));
    fireEvent.press(screen.getByText('english'));
    expect(change).toHaveBeenCalledWith('en');
    await waitFor(async () => expect(await AsyncStorage.getItem(LANG_KEY)).toBe('en'));
    change.mockRestore();
  });

  it('closes without choosing', () => {
    const change = jest.spyOn(i18next, 'changeLanguage');
    render(<ProfileScreen />);
    fireEvent.press(screen.getByText('menuLanguage'));
    fireEvent.press(screen.getByLabelText('common:close'));
    expect(screen.queryByText('languageTitle')).toBeNull();
    expect(change).not.toHaveBeenCalled();
    change.mockRestore();
  });
});
