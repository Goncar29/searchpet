// Signing out asks for confirmation in the same card as the theme and language
// pickers (ActionMenuModal), not in an Alert.alert with no design.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ProfileScreen from '../app/(tabs)/profile';

const mockLogout = jest.fn();

jest.mock('../store', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1', name: 'Carlos', email: 'carlos@example.com' },
    isAuthenticated: true,
    logout: mockLogout,
  }),
  useLanguageStore: (selector: any) => selector({ setLanguage: jest.fn() }),
}));

// The screen imports via '../../../shared/hooks'; from this test the same module
// resolves as '../../shared/hooks'.
jest.mock('../../shared/hooks', () => ({
  useMyPets: () => ({ data: [] }),
  usePublicProfile: () => ({ data: null }),
  useUploadProfilePhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useVerificationStatus: () => ({ data: { is_verified: false }, error: null }),
  useSendEmailOTP: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useConfirmEmailOTP: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// Echo the key. `use`/`init` must chain: the screen pulls LANG_KEY from
// ../../i18n, which bootstraps i18next at import time.
jest.mock('i18next', () => {
  const instance: any = {
    t: (key: string) => key,
    use: () => instance,
    init: () => Promise.resolve(),
    changeLanguage: () => Promise.resolve(),
    language: 'es',
  };
  return instance;
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.setTimeout(25000);

describe('ProfileScreen — cerrar sesión', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogout.mockClear();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  function openConfirmation() {
    render(<ProfileScreen />);
    fireEvent.press(screen.getByText('logout'));
  }

  it('pregunta en el cuadro, sin cerrar la sesión todavía', () => {
    openConfirmation();
    expect(screen.getByText('profile:logoutConfirmTitle')).toBeTruthy();
    expect(screen.getByText('profile:logoutConfirmMsg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'profile:logoutYes' })).toBeTruthy();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('confirmar cierra la sesión', () => {
    openConfirmation();
    fireEvent.press(screen.getByRole('button', { name: 'profile:logoutYes' }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('cerrar el cuadro no cierra la sesión', () => {
    openConfirmation();
    fireEvent.press(screen.getByRole('button', { name: 'common:close' }));
    expect(screen.queryByText('profile:logoutConfirmTitle')).toBeNull();

    fireEvent.press(screen.getByText('logout'));
    fireEvent.press(screen.getByTestId('action-menu-backdrop'));
    expect(screen.queryByText('profile:logoutConfirmTitle')).toBeNull();
    expect(mockLogout).not.toHaveBeenCalled();
  });
});
