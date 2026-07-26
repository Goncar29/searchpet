import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GoogleSignInButton, __resetGisLoaderForTests } from './GoogleSignInButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const initialize = vi.fn();
const renderButton = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  __resetGisLoaderForTests();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');
  // Pretend the GIS script is already on the page.
  window.google = { accounts: { id: { initialize, renderButton, cancel: vi.fn() } } };
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.google;
});

describe('GoogleSignInButton', () => {
  it('initialises GIS with the configured client id and renders the button', async () => {
    render(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(initialize.mock.calls[0][0].client_id).toBe('test-client-id.apps.googleusercontent.com');
    expect(renderButton).toHaveBeenCalledTimes(1);
  });

  it('forwards the credential to onCredential', async () => {
    const onCredential = vi.fn();
    render(<GoogleSignInButton onCredential={onCredential} onError={vi.fn()} />);

    await waitFor(() => expect(initialize).toHaveBeenCalled());
    // Simulate Google invoking the callback we registered.
    initialize.mock.calls[0][0].callback({ credential: 'fake-id-token' });

    expect(onCredential).toHaveBeenCalledWith('fake-id-token');
  });

  it('calls the LATEST onCredential, not the one captured at initialise time', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<GoogleSignInButton onCredential={first} onError={vi.fn()} />);

    await waitFor(() => expect(initialize).toHaveBeenCalled());
    rerender(<GoogleSignInButton onCredential={second} onError={vi.fn()} />);

    initialize.mock.calls[0][0].callback({ credential: 'fake-id-token' });

    // GIS initialise() runs once; without the ref indirection the stale first
    // callback would fire and the page would act on outdated state.
    expect(second).toHaveBeenCalledWith('fake-id-token');
    expect(first).not.toHaveBeenCalled();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when VITE_GOOGLE_CLIENT_ID is not configured', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const { container } = render(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(initialize).not.toHaveBeenCalled();
  });

  it('shows a placeholder until GIS is ready', () => {
    render(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText('auth:google.loading')).toBeInTheDocument();
  });
});
