import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * Single source of truth for "is Google Sign-In configured". Both this button
 * and the panel that frames it must agree, or the page renders a divider above
 * nothing.
 */
export function googleClientId(): string | undefined {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  return id ? id : undefined;
}

/**
 * The GIS script is a page-level singleton: loading it twice would register two
 * sets of globals. This promise is shared by every instance of the button.
 *
 * It is keyed by LOCALE because GIS decides its language when the script loads
 * (the `hl` query param) — `renderButton`'s `locale` option does NOT re-localize
 * a client that is already loaded. So following the app's language switcher
 * means dropping the script and loading it again.
 */
let gisPromise: Promise<void> | null = null;
let loadedLocale: string | null = null;

/** Test-only: clears the module-level singleton between test cases. */
export function __resetGisLoaderForTests() {
  gisPromise = null;
  loadedLocale = null;
}

function loadGis(locale: string): Promise<void> {
  if (gisPromise && loadedLocale === locale) return gisPromise;

  // Language changed after the script loaded — tear it down and start over.
  if (gisPromise) {
    document.querySelectorAll(`script[src^="${GIS_SRC}"]`).forEach((el) => el.remove());
    delete window.google;
  }

  loadedLocale = locale;
  gisPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `${GIS_SRC}?hl=${encodeURIComponent(locale)}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Reset so a later mount can retry — a one-off network blip should not
      // disable the button for the rest of the session.
      gisPromise = null;
      loadedLocale = null;
      reject(new Error('gis_load_failed'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

interface GoogleSignInButtonProps {
  /** Receives the Google ID token. The parent decides what to do with it. */
  onCredential: (idToken: string) => void;
  /** Called when the GIS script cannot be loaded at all. */
  onError: (message: string) => void;
}

/**
 * Renders Google's official sign-in button. Deliberately knows nothing about our
 * API or auth context: it produces an ID token and hands it up.
 *
 * Renders nothing when VITE_GOOGLE_CLIENT_ID is unset, so an environment without
 * Google configured simply shows the email/password form on its own.
 */
export function GoogleSignInButton({ onCredential, onError }: GoogleSignInButtonProps) {
  const { t, i18n } = useTranslation(['auth']);
  const clientId = googleClientId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // GIS initialize() runs once, but the callbacks close over page state that
  // changes between renders — refs keep the latest without re-initialising.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // `t` is NOT an effect dependency: react-i18next hands back a new function
  // identity on re-render, which would re-run initialize() and append a SECOND
  // Google button to the container. It is only read inside the catch, so a ref
  // is both sufficient and correct.
  const tRef = useRef(t);
  tRef.current = t;
  // GIS renders its own button label, so it needs the language explicitly —
  // otherwise the button says "Continue with Google" while everything around it
  // follows the app's es/en/pt switcher.
  const locale = i18n.language;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    loadGis(locale)
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => onCredentialRef.current(response.credential),
          cancel_on_tap_outside: true,
        });
        // GIS APPENDS its button rather than replacing the container's contents.
        // On a language change this effect re-runs, so without clearing first the
        // previous button stays on screen and the new one stacks beneath it —
        // which reads as "the button never changes language".
        containerRef.current.replaceChildren();
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: 320,
          locale,
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current(tRef.current('auth:google.loadError'));
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, locale]);

  if (!clientId) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} data-testid="google-signin-button" />
      {!ready && (
        <p className="text-sm text-gray-400 dark:text-gray-500">{t('auth:google.loading')}</p>
      )}
    </div>
  );
}
