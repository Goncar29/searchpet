import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';

type Step = 'email' | 'code';

// Igual al min=6 de ResetPasswordRequest en el backend, que a su vez iguala a
// RegisterRequest: exigir más en la recuperación que en el alta sería incoherente.
const MIN_PASSWORD_LENGTH = 6;

const inputClass =
  'w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

export function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');
    setLoading(true);
    try {
      await apiClient.forgotPassword(email.trim());
      // Always advance. The backend answers 200 whether or not the address is
      // registered; branching here would rebuild — in the client — the exact
      // enumeration oracle the backend deliberately closed.
      setStep('code');
    } catch (err) {
      setApiError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');

    // Sin este chequeo una contraseña corta viaja igual y vuelve como
    // binding_failed — "Los datos de entrada no son válidos", que no dice cuál
    // dato. En una pantalla donde el fallo esperado es "el código está mal", ese
    // mensaje genérico apunta al campo equivocado. RegisterPage ya valida así.
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setApiError(t('auth:register.passwordMin'));
      return;
    }

    setLoading(true);
    try {
      await apiClient.resetPassword(email.trim(), code.trim(), newPassword);
      // Drop the local session before leaving. The reset just invalidated every
      // token issued before it, so anything still held here is dead — and while
      // it is held, LoginPage's isAuthenticated guard bounces this navigation
      // straight back to "/", where the user sits with a token that 401s on the
      // next request and never sees the confirmation.
      logout();
      navigate('/login', { state: { notice: t('forgotPassword.success') } });
    } catch (err) {
      setApiError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="text-center mb-8">
        <Logo className="h-14 w-14 mx-auto mb-3 text-primary" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('forgotPassword.title')}
        </h1>
      </div>

      {step === 'email' ? (
        <form
          onSubmit={handleRequest}
          noValidate
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4"
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('forgotPassword.emailStepDescription')}
          </p>

          {apiError && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg">
              {apiError}
            </div>
          )}

          <div>
            <label htmlFor="forgot-email" className={labelClass}>
              {t('forgotPassword.email')}
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
          >
            {loading ? t('common:loading') : t('forgotPassword.sendCode')}
          </button>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            <Link to="/login" className="text-primary font-semibold hover:underline">
              {t('forgotPassword.backToLogin')}
            </Link>
          </p>
        </form>
      ) : (
        <form
          onSubmit={handleReset}
          noValidate
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4"
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('forgotPassword.codeStepDescription')}
          </p>

          {apiError && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg">
              {apiError}
            </div>
          )}

          <div>
            <label htmlFor="forgot-code" className={labelClass}>
              {t('forgotPassword.code')}
            </label>
            <input
              id="forgot-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="forgot-new-password" className={labelClass}>
              {t('forgotPassword.newPassword')}
            </label>
            <input
              id="forgot-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('forgotPassword.sessionsWarning')}
          </p>

          <button
            type="submit"
            disabled={loading || !code.trim() || !newPassword}
            className="w-full bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
          >
            {loading ? t('common:loading') : t('forgotPassword.submit')}
          </button>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            <Link to="/login" className="text-primary font-semibold hover:underline">
              {t('forgotPassword.backToLogin')}
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
