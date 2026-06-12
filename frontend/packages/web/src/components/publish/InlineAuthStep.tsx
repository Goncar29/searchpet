import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getErrorMessage } from '@shared/utils/apiErrors';

interface InlineAuthStepProps {
  onAuthenticated: () => void;
}

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function InlineAuthStep({ onAuthenticated }: InlineAuthStepProps) {
  const { t } = useTranslation(['publish', 'common']);
  const { t: tAuth } = useTranslation(['auth']);
  const { login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (tab === 'register' && !name.trim()) errors.name = t('common:required');
    if (!email.trim()) errors.email = t('common:required');
    if (!password) errors.password = t('common:required');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;

    setLoading(true);
    try {
      if (tab === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, name.trim(), undefined, undefined);
      }
      onAuthenticated();
    } catch (err) {
      setApiError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 text-center">
        {t('auth.title')}
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{t('auth.description')}</p>

      <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button
          type="button"
          onClick={() => setTab('login')}
          className={`flex-1 py-2 text-sm font-semibold ${tab === 'login' ? 'bg-primary text-white' : 'bg-transparent text-gray-700 dark:text-gray-300'}`}
        >
          {t('auth.loginTab')}
        </button>
        <button
          type="button"
          onClick={() => setTab('register')}
          className={`flex-1 py-2 text-sm font-semibold ${tab === 'register' ? 'bg-primary text-white' : 'bg-transparent text-gray-700 dark:text-gray-300'}`}
        >
          {t('auth.registerTab')}
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {tab === 'register' && (
          <div>
            <label htmlFor="inline-auth-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {tAuth('register.name')}
            </label>
            <input
              id="inline-auth-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {fieldErrors.name && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.name}</p>}
          </div>
        )}

        <div>
          <label htmlFor="inline-auth-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {tAuth('register.email')}
          </label>
          <input
            id="inline-auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {fieldErrors.email && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.email}</p>}
        </div>

        <div>
          <label htmlFor="inline-auth-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {tAuth('register.password')}
          </label>
          <input
            id="inline-auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {fieldErrors.password && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.password}</p>}
        </div>

        {apiError && <p className="text-red-500 dark:text-red-400 text-sm">{apiError}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {loading ? t('common:loading') : t('auth.continue')}
        </button>
      </form>
    </div>
  );
}
