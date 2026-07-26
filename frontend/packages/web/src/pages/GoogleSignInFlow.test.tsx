import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';

/**
 * Page-level composition of the Google flow.
 *
 * The component tests for GoogleSignInButton and LocationOnboardingStep both
 * pass in isolation, but neither can catch the bug this file exists for: after
 * `loginWithGoogle` stores the token, `isAuthenticated` flips to true, and the
 * "already signed in, go away" guard at the top of each page fires BEFORE the
 * onboarding step ever renders. The whole new-user onboarding was dead code.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => [new URLSearchParams()],
  };
});

vi.mock('@shared/api/client', () => ({
  apiClient: { updateMyLocation: vi.fn().mockResolvedValue({}) },
}));

// GoogleSignInButton is exercised by its own tests; here it is reduced to a
// button that hands up a credential, so these tests are about composition only.
vi.mock('../components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: ({ onCredential }: { onCredential: (t: string) => void }) => (
    <button type="button" onClick={() => onCredential('fake-id-token')}>
      google-signin
    </button>
  ),
}));

// A stateful auth mock: signing in with Google flips isAuthenticated to true,
// exactly as AuthContext does by calling setToken before resolving.
let isAuthenticated = false;
let isNewUser = true;
const loginWithGoogle = vi.fn(async () => {
  isAuthenticated = true;
  return isNewUser;
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    login: vi.fn(),
    register: vi.fn(),
    loginWithGoogle,
    isAuthenticated,
    isLoading: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  isAuthenticated = false;
  isNewUser = true;
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');
});

const pages = [
  ['LoginPage', LoginPage],
  ['RegisterPage', RegisterPage],
] as const;

describe.each(pages)('%s — Google flow composition', (_name, Page) => {
  it('shows the location step for a NEW user instead of redirecting away', async () => {
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'google-signin' }));

    await waitFor(() => expect(loginWithGoogle).toHaveBeenCalledWith('fake-id-token'));
    // The signed-in guard must NOT swallow the onboarding step.
    await waitFor(() =>
      expect(screen.getByText('auth:location.title')).toBeInTheDocument(),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends a RETURNING user straight into the app', async () => {
    isNewUser = false;
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'google-signin' }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(screen.queryByText('auth:location.title')).not.toBeInTheDocument();
  });

  it('leaves the app once the location step is finished', async () => {
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'google-signin' }));
    await waitFor(() => screen.getByText('auth:location.title'));

    await userEvent.click(screen.getByRole('button', { name: 'auth:location.skip' }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });
});
