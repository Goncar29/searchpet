import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateMe, useUploadProfilePhoto, useMyBadges } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import type { Badge } from '@shared/types';

const BADGE_META: Record<string, { emoji: string; label: string }> = {
  first_helper: { emoji: '🤝', label: 'Primer Ayudante' },
  pet_rescuer: { emoji: '🦸', label: 'Rescatador' },
  social_butterfly: { emoji: '📣', label: 'Social' },
  verified_finder: { emoji: '✓', label: 'Verificado' },
};

export function ProfilePage() {
  const { t } = useTranslation(['profile', 'common']);
  const { user, refreshUser } = useAuth();
  const updateMe = useUpdateMe();
  const uploadPhoto = useUploadProfilePhoto();
  const { data: badges } = useMyBadges();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState('');
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState('');
  const [photoError, setPhotoError] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone ?? '');
    }
  }, [user]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX = 5 * 1024 * 1024;

    if (!ALLOWED.includes(file.type)) {
      setPhotoError('Formato no permitido. Usá JPG, PNG o WebP.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX) {
      setPhotoError('La foto no puede superar los 5 MB.');
      e.target.value = '';
      return;
    }

    setPhotoError('');
    uploadPhoto.mutate(file, {
      onSuccess: async () => {
        await refreshUser();
      },
      onError: (err) => {
        setPhotoError(err.message);
      },
    });
  };

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
          <div className="flex items-center gap-5">
            {/* Avatar clickeable */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadPhoto.isPending}
              className="relative flex-shrink-0 group"
              title={t('profile:changePhoto')}
            >
              {user.profile_photo_url ? (
                <img
                  src={user.profile_photo_url}
                  alt={user.name}
                  className="w-20 h-20 rounded-full object-cover border-2 border-gray-200 dark:border-gray-700"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-3xl font-bold text-primary">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
              {/* Overlay al hover */}
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 group-disabled:opacity-100 transition-opacity">
                {uploadPhoto.isPending ? (
                  <span className="text-white text-xs">...</span>
                ) : (
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </div>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoChange}
              className="hidden"
            />

            <div>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-50">{user.name}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
              {user.is_verified && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400 mt-1">
                  ✓ {t('profile:verified')}
                </span>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {t('profile:changePhoto')}
              </p>
            </div>
          </div>
          {photoError && (
            <p className="text-red-500 dark:text-red-400 text-sm mt-3">{photoError}</p>
          )}
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

        {/* Mis logros */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50 mb-4">
            Mis logros
          </h2>
          {!badges || badges.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-3xl mb-2">🏅</p>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Todavía no tenés logros. ¡Empezá reportando mascotas!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {badges.map((badge: Badge) => {
                const meta = BADGE_META[badge.badge_type] ?? { emoji: '🏅', label: badge.badge_type };
                return (
                  <div
                    key={badge.id}
                    className="flex items-center gap-2 p-3 rounded-xl bg-primary/5 border border-primary/20"
                  >
                    <span className="text-xl">{meta.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900 dark:text-gray-50 truncate">
                        {meta.label}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(badge.earned_at).toLocaleDateString('es-UY', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
