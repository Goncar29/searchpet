import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateMe } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';

export function ProfilePage() {
  const { t } = useTranslation(['profile', 'common']);
  const { user, refreshUser } = useAuth();
  const updateMe = useUpdateMe();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState('');
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState('');

  // Pre-fill form when user data is available
  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone ?? '');
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError('');
    setApiError('');
    setSuccess(false);

    if (!name.trim()) {
      setNameError(t('common:required'));
      return;
    }

    updateMe.mutate(
      { name: name.trim(), phone: phone.trim() },
      {
        onSuccess: async () => {
          await refreshUser();
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        },
        onError: (err) => {
          setApiError(err.message);
        },
      }
    );
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-8">
          {t('profile:title')}
        </h1>

        {/* Avatar + info básica */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary flex-shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-50">{user.name}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
              {user.is_verified && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400 mt-1">
                  ✓ {t('profile:verified')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Formulario de edición */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50 mb-5">
            {t('profile:editTitle')}
          </h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Email — read only */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('profile:email')}
              </label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 px-3 py-2 text-sm cursor-not-allowed"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {t('profile:emailReadOnly')}
              </p>
            </div>

            {/* Nombre */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('profile:name')} *
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError('');
                }}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {nameError && (
                <p className="text-red-500 dark:text-red-400 text-sm mt-1">{nameError}</p>
              )}
            </div>

            {/* Teléfono */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('profile:phone')}
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('profile:phonePlaceholder')}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {t('profile:phoneHint')}
              </p>
            </div>

            {apiError && (
              <p className="text-red-500 dark:text-red-400 text-sm">{apiError}</p>
            )}

            {success && (
              <p className="text-green-600 dark:text-green-400 text-sm font-medium">
                {t('profile:saveSuccess')}
              </p>
            )}

            <button
              type="submit"
              disabled={updateMe.isPending}
              className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
            >
              {updateMe.isPending ? t('common:loading') : t('profile:save')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
