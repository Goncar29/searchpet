import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GoogleSignInButton, __resetGisLoaderForTests } from './GoogleSignInButton';

let currentLang = 'es';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: currentLang } }),
}));

const initialize = vi.fn();
// The real GIS APPENDS its button into the container. Mirroring that is what
// makes the stale-button bug observable in a test.
const renderButton = vi.fn((parent: HTMLElement, _options: GoogleButtonConfiguration) => {
  const btn = document.createElement('div');
  btn.setAttribute('data-gis-button', '');
  parent.appendChild(btn);
});

function installGoogleStub() {
  window.google = { accounts: { id: { initialize, renderButton, cancel: vi.fn() } } };
}

/** The most recently injected GIS script, or undefined. */
function lastGisScript(): HTMLScriptElement | undefined {
  const all = gisScripts();
  return all[all.length - 1];
}

/** The <script> elements the component injected, in order. */
function gisScripts() {
  return Array.from(document.querySelectorAll('script[src*="gsi/client"]')) as HTMLScriptElement[];
}

beforeEach(() => {
  vi.clearAllMocks();
  currentLang = 'es';
  __resetGisLoaderForTests();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');

  // jsdom never fetches scripts, so stand in for the browser: when the component
  // injects the GIS script, install the global and fire onload.
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
    const el = node as HTMLScriptElement;
    const res = append(node);
    if (el.tagName === 'SCRIPT' && String(el.src).includes('gsi/client')) {
      installGoogleStub();
      setTimeout(() => el.onload?.(new Event('load')), 0);
    }
    return res;
  }) as typeof document.head.appendChild);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete window.google;
  gisScripts().forEach((el) => el.remove());
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

  it('reloads GIS with the new language when the app language changes', async () => {
    const { rerender } = render(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    expect(lastGisScript()?.src).toContain('hl=es');

    currentLang = 'en';
    rerender(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);

    // GIS fixes its language when the SCRIPT loads — renderButton's `locale`
    // option does not re-localize an already-loaded client. So the only thing
    // that actually follows the app's switcher is a fresh script with ?hl=.
    await waitFor(() => expect(lastGisScript()?.src).toContain('hl=en'));
    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    expect(renderButton.mock.calls[1]?.[1].locale).toBe('en');

    // Exactly one script and one button survive — no piling up.
    expect(gisScripts()).toHaveLength(1);
    expect(
      screen.getAllByTestId('google-signin-button')[0]?.querySelectorAll('[data-gis-button]'),
    ).toHaveLength(1);
  });
});
