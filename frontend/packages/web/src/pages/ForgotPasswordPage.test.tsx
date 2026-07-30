import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ForgotPasswordPage } from './ForgotPasswordPage';

const forgotPassword = vi.fn();
const resetPassword = vi.fn();
const logout = vi.fn();
const navigate = vi.fn();

vi.mock('@shared/api/client', () => ({
  apiClient: {
    forgotPassword: (...a: unknown[]) => forgotPassword(...a),
    resetPassword: (...a: unknown[]) => resetPassword(...a),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ logout }),
}));

vi.mock('react-router', async () => ({
  ...(await vi.importActual<typeof import('react-router')>('react-router')),
  useNavigate: () => navigate,
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  forgotPassword.mockReset().mockResolvedValue({ message: 'ok' });
  resetPassword.mockReset().mockResolvedValue({ message: 'ok' });
  logout.mockReset();
  navigate.mockReset();
});

// Drives the page through both steps to a successful reset.
const completeReset = async () => {
  renderPage();

  fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
    target: { value: 'user@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

  fireEvent.change(await screen.findByLabelText('forgotPassword.code'), {
    target: { value: '123456' },
  });
  fireEvent.change(screen.getByLabelText('forgotPassword.newPassword'), {
    target: { value: 'newpassword' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.submit' }));
};

describe('ForgotPasswordPage', () => {
  it('moves to the code step after requesting one', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('user@example.com'));
    expect(await screen.findByLabelText('forgotPassword.code')).toBeInTheDocument();
  });

  it('advances even for an address that does not exist', async () => {
    // The backend answers 200 either way. Branching here would rebuild, in the
    // client, the enumeration oracle the backend deliberately closed.
    renderPage();

    fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
      target: { value: 'ghost@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

    expect(await screen.findByLabelText('forgotPassword.code')).toBeInTheDocument();
  });

  it('submits the code and the new password together', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

    fireEvent.change(await screen.findByLabelText('forgotPassword.code'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByLabelText('forgotPassword.newPassword'), {
      target: { value: 'newpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.submit' }));

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith('user@example.com', '123456', 'newpassword'),
    );
  });

  it('drops the local session before leaving', async () => {
    // The reset invalidated every token issued before it. Holding on to the dead
    // one makes LoginPage's isAuthenticated guard bounce the user to "/", where
    // they never see the confirmation and 401 on the next request instead.
    await completeReset();

    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it('hands the success notice to the login page', async () => {
    await completeReset();

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/login', {
        state: { notice: 'forgotPassword.success' },
      }),
    );
  });
});
