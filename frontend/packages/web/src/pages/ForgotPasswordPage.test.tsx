import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
  // jsdom comparte sessionStorage entre tests del mismo archivo: sin esto, el
  // deadline que deja un test arranca al siguiente en mitad de la cuenta regresiva.
  sessionStorage.clear();
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

  it('rejects a short password before it reaches the API', async () => {
    // El backend la rechaza con binding_failed — "datos de entrada inválidos" —
    // que no identifica el campo. En una pantalla donde el fallo esperado es "el
    // código está mal", ese mensaje manda al usuario a mirar el campo equivocado.
    renderPage();

    fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

    fireEvent.change(await screen.findByLabelText('forgotPassword.code'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByLabelText('forgotPassword.newPassword'), {
      target: { value: 'corta' }, // 5 caracteres
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.submit' }));

    expect(await screen.findByText('auth:register.passwordMin')).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
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

  it('shows the daily-limit policy on the email step', () => {
    // FIXED text: it states policy, never account state. A real "2 of 3 left"
    // counter is computable only for an account that exists, so rendering one
    // would rebuild the enumeration oracle the backend was shaped to deny.
    renderPage();
    expect(screen.getByText('forgotPassword.dailyLimitNotice')).toBeInTheDocument();
  });

  it('disables resend with a countdown, then re-enables it after 60s', async () => {
    // shouldAdvanceTime keeps findBy* from hanging under fake timers.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();

      fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

      // The i18n mock drops the interpolation object, so the accessible name is
      // the bare key — which is exactly what distinguishes the two states.
      const resend = await screen.findByRole('button', { name: 'forgotPassword.resendIn' });
      expect(resend).toBeDisabled();

      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });

      expect(
        await screen.findByRole('button', { name: 'forgotPassword.resend' }),
      ).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks a fresh request while the cooldown is live, so F5 cannot overwrite the deadline', async () => {
    // `step` no se persiste: un F5 durante el cooldown devuelve al paso del email.
    // Sin la guarda, el usuario reenvia, el backend se lo come en silencio, la UI
    // dice que mando un codigo, y el submit PISA el deadline vivo.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { unmount } = renderPage();
      fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));
      await screen.findByLabelText('forgotPassword.code');
      expect(forgotPassword).toHaveBeenCalledTimes(1);

      // Simula el F5: se remonta la pagina, que arranca en el paso del email y
      // relee el deadline de sessionStorage.
      unmount();
      renderPage();

      fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
        target: { value: 'user@example.com' },
      });
      const submit = screen.getByRole('button', { name: 'forgotPassword.resendIn' });
      expect(submit).toBeDisabled();
      fireEvent.click(submit);
      expect(forgotPassword).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the typed code when a new one is requested', async () => {
    // El backend retira los codigos anteriores en cada pedido. Dejar el viejo en
    // el input hace que el usuario lo mande y queme uno de los 5 intentos.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

      const codeInput = await screen.findByLabelText('forgotPassword.code');
      fireEvent.change(codeInput, { target: { value: '111111' } });
      expect(codeInput).toHaveValue('111111');

      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });
      fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.resend' }));

      await waitFor(() => expect(screen.getByLabelText('forgotPassword.code')).toHaveValue(''));
    } finally {
      vi.useRealTimers();
    }
  });
});
