import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { apiClient } from '../../shared/api/client';
import ForgotPasswordScreen from '../app/forgot-password';

// expo-router is mocked in jest.setup.js
// @shared/api/client (via the relative-path mapper) is mocked in
// __mocks__/shared-api-client.js — same convention as google-location.test.tsx.

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es', changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

beforeEach(() => {
  jest.clearAllMocks();
  (apiClient.forgotPassword as jest.Mock).mockResolvedValue({ message: 'ok' });
  (apiClient.resetPassword as jest.Mock).mockResolvedValue({ message: 'ok' });
});

describe('ForgotPasswordScreen', () => {
  // SECURITY: the backend answers 200 whether or not the address is
  // registered (see PasswordResetService.RequestReset). If the screen ever
  // branched on the result to decide whether to advance, it would rebuild —
  // in the client — the exact enumeration oracle the backend was shaped to
  // deny. This test intentionally uses an address containing "ghost" to make
  // that branch, if ever added, visible as a failure here.
  it('advances to the code step for any well-formed address, including an unregistered one', async () => {
    render(<ForgotPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('forgotPassword.email'), 'ghost@example.com');
    fireEvent.press(screen.getByText('forgotPassword.sendCode'));

    await waitFor(() => expect(apiClient.forgotPassword).toHaveBeenCalledWith('ghost@example.com'));
    expect(await screen.findByPlaceholderText('forgotPassword.code')).toBeTruthy();
  });

  it('shows the sessions warning before letting the user submit the reset', async () => {
    render(<ForgotPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('forgotPassword.email'), 'user@example.com');
    fireEvent.press(screen.getByText('forgotPassword.sendCode'));

    await screen.findByPlaceholderText('forgotPassword.code');
    expect(screen.getByText('forgotPassword.sessionsWarning')).toBeTruthy();
  });

  it('submits code and new password together', async () => {
    render(<ForgotPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('forgotPassword.email'), 'user@example.com');
    fireEvent.press(screen.getByText('forgotPassword.sendCode'));

    fireEvent.changeText(await screen.findByPlaceholderText('forgotPassword.code'), '123456');
    fireEvent.changeText(screen.getByPlaceholderText('forgotPassword.newPassword'), 'newpassword');
    fireEvent.press(screen.getByText('forgotPassword.submit'));

    await waitFor(() =>
      expect(apiClient.resetPassword).toHaveBeenCalledWith('user@example.com', '123456', 'newpassword'),
    );
  });

  it('rejects a short password before it reaches the API', async () => {
    // El backend la rechaza con binding_failed ("datos de entrada inválidos"),
    // que no identifica el campo. En esta pantalla el fallo que el usuario espera
    // es "el código está mal", así que ese mensaje lo manda al campo equivocado.
    render(<ForgotPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('forgotPassword.email'), 'user@example.com');
    fireEvent.press(screen.getByText('forgotPassword.sendCode'));

    fireEvent.changeText(await screen.findByPlaceholderText('forgotPassword.code'), '123456');
    fireEvent.changeText(screen.getByPlaceholderText('forgotPassword.newPassword'), 'corta');
    fireEvent.press(screen.getByText('forgotPassword.submit'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(apiClient.resetPassword).not.toHaveBeenCalled();
  });

  it('shows the API error and stays on the code step when the reset fails', async () => {
    (apiClient.resetPassword as jest.Mock).mockRejectedValue(new Error('otp invalid'));
    render(<ForgotPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('forgotPassword.email'), 'user@example.com');
    fireEvent.press(screen.getByText('forgotPassword.sendCode'));

    fireEvent.changeText(await screen.findByPlaceholderText('forgotPassword.code'), '000000');
    fireEvent.changeText(screen.getByPlaceholderText('forgotPassword.newPassword'), 'newpassword');
    fireEvent.press(screen.getByText('forgotPassword.submit'));

    await waitFor(() => expect(apiClient.resetPassword).toHaveBeenCalled());
    // Still on the code step — a failed reset must not silently advance or reset the flow.
    expect(screen.getByPlaceholderText('forgotPassword.code')).toBeTruthy();
  });
});
