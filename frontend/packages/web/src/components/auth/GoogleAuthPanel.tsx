import { useTranslation } from 'react-i18next';
import { GoogleSignInButton } from './GoogleSignInButton';

interface GoogleAuthPanelProps {
  /** Message to show above the button, or '' for none. */
  error: string;
  onCredential: (idToken: string) => void;
  onError: (message: string) => void;
}

/**
 * The "continue with Google" card plus the "or" divider that separates it from
 * the email/password form below.
 *
 * Extracted because LoginPage and RegisterPage render it identically — the two
 * would drift apart on the first styling change otherwise. Renders nothing at
 * all when Google is unconfigured, because GoogleSignInButton returns null and
 * a lone divider above a form would be nonsense.
 */
export function GoogleAuthPanel({ error, onCredential, onError }: GoogleAuthPanelProps) {
  const { t } = useTranslation(['auth']);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  if (!clientId) return null;

  return (
    <>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-4">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg mb-3">
            {error}
          </div>
        )}
        <GoogleSignInButton onCredential={onCredential} onError={onError} />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {t('auth:google.divider')}
        </span>
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
      </div>
    </>
  );
}
