// Profile screen — email verification limits
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ApiError } from '../../shared/api/client';
import ProfileScreen from '../app/(tabs)/profile';

// expo-router is mocked globally in jest.setup.js

// The screen reads the saved language on mount. The real module needs a native
// module that does not exist under jest.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

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

describe('ProfileScreen — límites de verificación por email', () => {
  beforeEach(() => {
    mockSendEmailOTP.mutateAsync = jest.fn();
    mockSendEmailOTP.isPending = false;
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // El 429 del cooldown venía sin `code`, así que el usuario leía un fallo
  // genérico; y el botón quedaba activo, invitando a repetir el pedido que el
  // backend ya rechazó.
  it('con el cooldown arranca el contador en los segundos del servidor', async () => {
    mockSendEmailOTP.mutateAsync = jest
      .fn()
      .mockRejectedValue(new ApiError('otp_cooldown', 429, 'otp_cooldown', 45));

    render(<ProfileScreen />);

    fireEvent.press(screen.getByText('verifyEmail'));
    fireEvent.press(screen.getByText('sendCode'));

    // Cuarenta y pico, no los 60 fijos del camino feliz. El rango absorbe el
    // tick que corre mientras el test espera.
    await waitFor(() => {
      expect(screen.getByText(/^resendIn:4\d$/)).toBeTruthy();
    });
    expect(Alert.alert).toHaveBeenCalledWith('common:error', 'T(errors:otp_cooldown)');
  });

  // El tope diario se cuenta en horas: un contador segundo a segundo durante 20
  // horas sería ruido, así que ese caso sólo avisa.
  it('con el tope diario avisa pero NO arranca contador', async () => {
    mockSendEmailOTP.mutateAsync = jest
      .fn()
      .mockRejectedValue(new ApiError('otp_daily_limit', 429, 'otp_daily_limit', 72000));

    render(<ProfileScreen />);

    fireEvent.press(screen.getByText('verifyEmail'));
    fireEvent.press(screen.getByText('sendCode'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('common:error', 'T(errors:otp_daily_limit)');
    });
    expect(screen.queryByText(/^resendIn:/)).toBeNull();
  });
});
