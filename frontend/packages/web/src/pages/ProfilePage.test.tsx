import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@shared/api/client';
import { ProfilePage } from './ProfilePage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Interpolate so the countdown's seconds are observable in the rendered text.
      if (opts && 'seconds' in opts) return `${key}:${opts.seconds}`;
      // getErrorMessage treats "t returned the key unchanged" as "no translation
      // exists" and falls back to unknown_error. An identity mock would therefore
      // collapse every code into the same string and assert nothing about which
      // error was surfaced, so error keys must resolve to something distinct.
      if (key.startsWith('errors:')) return `T(${key})`;
      return key;
    },
    i18n: { language: 'es' },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Carlos', email: 'carlos@example.com', is_verified: false, created_at: '' },
    refreshUser: vi.fn(),
  }),
}));

// Mutable so each test can drive what the send mutation does.
const sendEmailOTP = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));

vi.mock('@shared/hooks', () => ({
  useUpdateMe: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadProfilePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMyBadges: () => ({ data: [] }),
  useVerificationStatus: () => ({ data: null }),
  useSendEmailOTP: () => sendEmailOTP,
  useConfirmEmailOTP: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePublicProfile: () => ({ data: null, isLoading: false }),
}));

vi.mock('@shared/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/types')>();
  return { ...actual, BADGE_META: {} };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    sendEmailOTP.mutateAsync = vi.fn();
    sendEmailOTP.isPending = false;
  });

  it('renderiza sin lanzar errores', () => {
    render(<ProfilePage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  // El 429 del cooldown venia sin `code`, asi que getErrorMessage caia en
  // unknown_error y el usuario leia un fallo generico. Y el boton quedaba
  // clickeable, invitando a repetir el pedido que el backend ya rechazo.
  it('muestra el mensaje del cooldown y arranca el contador con los segundos del servidor', async () => {
    sendEmailOTP.mutateAsync = vi.fn().mockRejectedValue(
      new ApiError('otp_cooldown', 429, 'otp_cooldown', 45)
    );

    render(<ProfilePage />, { wrapper });

    await userEvent.click(screen.getByText('profile:verifyEmail'));
    await userEvent.click(screen.getByText('profile:sendCode'));

    // El mensaje sale del `code`, no de un texto generico.
    expect(await screen.findByText('T(errors:otp_cooldown)')).toBeInTheDocument();
    // Y el contador arranca en lo que dijo el servidor, no en los 60 fijos. El
    // rango cubre el tick que corre mientras el test espera; lo que importa es
    // que sean cuarenta y pico y no sesenta.
    expect(screen.getByText(/^profile:resendIn:4\d$/)).toBeInTheDocument();
  });

  // El tope diario se cuenta en horas: un contador segundo a segundo durante 20
  // horas seria ruido, asi que ese caso solo muestra el mensaje.
  it('con el tope diario muestra el mensaje pero NO arranca contador', async () => {
    sendEmailOTP.mutateAsync = vi.fn().mockRejectedValue(
      new ApiError('otp_daily_limit', 429, 'otp_daily_limit', 72000)
    );

    render(<ProfilePage />, { wrapper });

    await userEvent.click(screen.getByText('profile:verifyEmail'));
    await userEvent.click(screen.getByText('profile:sendCode'));

    expect(await screen.findByText('T(errors:otp_daily_limit)')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/^profile:resendIn:/)).not.toBeInTheDocument();
    });
  });

  // Reenviar acuna un codigo nuevo y RETIRA el anterior, asi que lo que quedo
  // tipeado ya no puede matchear: enviarlo quema uno de los 5 intentos y
  // devuelve "invalido" sin explicar nada. Mismo defecto que ya se cerro en la
  // recuperacion de contrasena (8155d1c) y seguia abierto aca.
  it('al reenviar vacia el codigo viejo del input', async () => {
    // Un cooldown de 1s es la via barata de llegar al paso de confirmacion con un
    // contador que expira solo: el boton de reenviar solo existe en cero.
    sendEmailOTP.mutateAsync = vi.fn().mockRejectedValue(
      new ApiError('otp_cooldown', 429, 'otp_cooldown', 1)
    );

    render(<ProfilePage />, { wrapper });

    await userEvent.click(screen.getByText('profile:verifyEmail'));
    await userEvent.click(screen.getByText('profile:sendCode'));

    const input = await screen.findByPlaceholderText('000000');
    await userEvent.type(input, '123456');
    expect(input).toHaveValue('123456');

    // El reenvio ahora SI acuna: es el unico camino que invalida lo tipeado.
    sendEmailOTP.mutateAsync = vi.fn().mockResolvedValue(undefined);
    const resend = await screen.findByText('profile:resendCode', {}, { timeout: 3000 });
    await userEvent.click(resend);

    await waitFor(() => expect(input).toHaveValue(''));
  });
});
