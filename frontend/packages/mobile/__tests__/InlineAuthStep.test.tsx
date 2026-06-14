// InlineAuthStep smoke test
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { InlineAuthStep } from '../components/publish/InlineAuthStep';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es', changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

const mockLogin = jest.fn().mockResolvedValue(undefined);
const mockRegister = jest.fn().mockResolvedValue(undefined);

jest.mock('../store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    const state = { login: mockLogin, register: mockRegister };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

describe('InlineAuthStep', () => {
  beforeEach(() => {
    mockLogin.mockClear();
    mockRegister.mockClear();
  });

  it('renders the login form by default and calls onAuthenticated after a successful login', async () => {
    const onAuthenticated = jest.fn();
    render(<InlineAuthStep onAuthenticated={onAuthenticated} />);

    expect(screen.getByText('publish:auth.title')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('auth:login.email'), 'carlos@test.com');
    fireEvent.changeText(screen.getByPlaceholderText('auth:login.password'), 'password123');
    fireEvent.press(screen.getByText('publish:auth.continue'));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('carlos@test.com', 'password123'));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
  });

  it('switches to the register tab and calls register with name, email, and password', async () => {
    const onAuthenticated = jest.fn();
    render(<InlineAuthStep onAuthenticated={onAuthenticated} />);

    fireEvent.press(screen.getByText('publish:auth.registerTab'));

    fireEvent.changeText(screen.getByPlaceholderText('auth:register.name'), 'Carlos');
    fireEvent.changeText(screen.getByPlaceholderText('auth:register.email'), 'carlos@test.com');
    fireEvent.changeText(screen.getByPlaceholderText('auth:register.password'), 'password123');
    fireEvent.press(screen.getByText('publish:auth.continue'));

    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith('carlos@test.com', 'password123', 'Carlos'));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
  });
});
