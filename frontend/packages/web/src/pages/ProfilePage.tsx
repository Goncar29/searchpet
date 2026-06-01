import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateMe, useUploadProfilePhoto, useMyBadges, useVerificationStatus, useSendEmailOTP, useConfirmEmailOTP, useSendSmsOTP, useConfirmSmsOTP, usePublicProfile } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import type { Badge } from '@shared/types';
import { BADGE_META } from '@shared/types';

export function ProfilePage() {
  const { t } = useTranslation(['profile', 'common']);
  const { user, refreshUser } = useAuth();
  const updateMe = useUpdateMe();
  const uploadPhoto = useUploadProfilePhoto();
  const { data: badges } = useMyBadges();
  const { data: publicProfile, isLoading: statsLoading } = usePublicProfile(user?.id ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState('');
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState('');
  const [photoError, setPhotoError] = useState('');

  // Verification state
  const { data: verificationStatus, error: verificationError } = useVerificationStatus();
  const sendEmailOTP = useSendEmailOTP();
  const confirmEmailOTP = useConfirmEmailOTP();
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);
  const verificationDisabled = (verificationError as any)?.status === 501;

  // SMS OTP state
  const sendSmsOTP = useSendSmsOTP();
  const confirmSmsOTP = useConfirmSmsOTP();
  const [smsAccordionOpen, setSmsAccordionOpen] = useState(false);
  const [smsOtpSent, setSmsOtpSent] = useState(false);
  const [smsVerifyCode, setSmsVerifyCode] = useState('');
  const [smsVerifyError, setSmsVerifyError] = useState('');
  const [smsResendCountdown, setSmsResendCountdown] = useState(0);
  const [smsUnavailable, setSmsUnavailable] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone ?? '');
    }
  }, [user]);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  useEffect(() => {
    if (smsResendCountdown <= 0) return;
    const timer = setTimeout(() => setSmsResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [smsResendCountdown]);

  const handleSendSmsOTP = async () => {
    setSmsVerifyError('');
    setSmsUnavailable(false);
    try {
      await sendSmsOTP.mutateAsync(phone.trim());
      setSmsOtpSent(true);
      setSmsResendCountdown(60);
    } catch (err: any) {
      if (err.status === 501) {
        setSmsUnavailable(true);
      } else {
        setSmsVerifyError(err.message || 'No se pudo enviar el código SMS');
      }
    }
  };

  const handleConfirmSmsOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmsVerifyError('');
    if (smsVerifyCode.length !== 6) {
      setSmsVerifyError('Ingresá el código de 6 dígitos');
      return;
    }
    try {
      await confirmSmsOTP.mutateAsync({ phone: phone.trim(), code: smsVerifyCode });
      setSmsAccordionOpen(false);
      setSmsOtpSent(false);
      setSmsVerifyCode('');
    } catch (err: any) {
      setSmsVerifyError(err.message || 'Código incorrecto o expirado');
    }
  };

  const handleSendOTP = async () => {
    try {
      await sendEmailOTP.mutateAsync();
      setOtpSent(true);
      setResendCountdown(60);
    } catch (err: any) {
      setVerifyError(err.message || 'No se pudo enviar el código');
    }
  };

  const handleConfirmOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError('');
    if (verifyCode.length !== 6) {
      setVerifyError('Ingresá el código de 6 dígitos');
      return;
    }
    try {
      await confirmEmailOTP.mutateAsync(verifyCode);
      setAccordionOpen(false);
      setOtpSent(false);
      setVerifyCode('');
    } catch (err: any) {
      setVerifyError(err.message || 'Código incorrecto o expirado');
    }
  };

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

        {/* Verificación — oculto si feature flag deshabilitado (501) */}
        {!verificationDisabled && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
                Verificación de cuenta
              </h2>
              {verificationStatus?.is_verified ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-1 rounded-full">
                  Verificado
                </span>
              ) : verificationStatus !== undefined ? (
                <button
                  type="button"
                  onClick={() => setAccordionOpen((o) => !o)}
                  className="text-sm font-medium text-primary flex items-center gap-1"
                  aria-expanded={accordionOpen}
                >
                  Verificar email
                  <span className={`transition-transform ${accordionOpen ? 'rotate-180' : ''}`}>▾</span>
                </button>
              ) : null}
            </div>

            {accordionOpen && !verificationStatus?.is_verified && (
              <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
                {!otpSent ? (
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Te enviaremos un código a <strong>{user?.email}</strong>.
                    </p>
                    {verifyError && (
                      <p className="text-sm text-red-500 dark:text-red-400 mb-2">{verifyError}</p>
                    )}
                    <button
                      type="button"
                      onClick={handleSendOTP}
                      disabled={sendEmailOTP.isPending}
                      className="bg-primary hover:bg-primary-dark disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                    >
                      {sendEmailOTP.isPending ? 'Enviando...' : 'Enviar código'}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleConfirmOTP} noValidate>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Revisá tu correo e ingresá el código de 6 dígitos.
                    </p>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={verifyCode}
                      onChange={(e) => { setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setVerifyError(''); }}
                      placeholder="000000"
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-center text-xl tracking-widest mb-2 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {verifyError && (
                      <p className="text-sm text-red-500 dark:text-red-400 mb-2">{verifyError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={confirmEmailOTP.isPending}
                      className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors mb-2"
                    >
                      {confirmEmailOTP.isPending ? 'Verificando...' : 'Confirmar código'}
                    </button>
                    {resendCountdown > 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                        Reenviar en {resendCountdown}s
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSendOTP}
                        disabled={sendEmailOTP.isPending}
                        className="w-full text-xs text-primary font-medium text-center disabled:opacity-60"
                      >
                        Reenviar código
                      </button>
                    )}
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* Verificación de teléfono (SMS OTP) — solo si teléfono no verificado */}
        {verificationStatus?.phone_verified === false && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
                Verificación de teléfono
              </h2>
              {smsUnavailable ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
                  SMS no disponible
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setSmsAccordionOpen((o) => !o)}
                  className="text-sm font-medium text-primary flex items-center gap-1"
                  aria-expanded={smsAccordionOpen}
                >
                  Verificar teléfono
                  <span className={`transition-transform ${smsAccordionOpen ? 'rotate-180' : ''}`}>▾</span>
                </button>
              )}
            </div>

            {smsAccordionOpen && !smsUnavailable && (
              <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
                {!smsOtpSent ? (
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Te enviaremos un código SMS a <strong>{phone || 'tu número de teléfono'}</strong>.
                    </p>
                    {smsVerifyError && (
                      <p className="text-sm text-red-500 dark:text-red-400 mb-2">{smsVerifyError}</p>
                    )}
                    <button
                      type="button"
                      onClick={handleSendSmsOTP}
                      disabled={sendSmsOTP.isPending || !phone.trim()}
                      className="bg-primary hover:bg-primary-dark disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                    >
                      {sendSmsOTP.isPending ? 'Enviando...' : 'Enviar código SMS'}
                    </button>
                    {!phone.trim() && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                        Primero agregá un número de teléfono en tu perfil.
                      </p>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleConfirmSmsOTP} noValidate>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Revisá tu teléfono e ingresá el código de 6 dígitos.
                    </p>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={smsVerifyCode}
                      onChange={(e) => { setSmsVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setSmsVerifyError(''); }}
                      placeholder="000000"
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-center text-xl tracking-widest mb-2 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {smsVerifyError && (
                      <p className="text-sm text-red-500 dark:text-red-400 mb-2">{smsVerifyError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={confirmSmsOTP.isPending}
                      className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors mb-2"
                    >
                      {confirmSmsOTP.isPending ? 'Verificando...' : 'Confirmar código'}
                    </button>
                    {smsResendCountdown > 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                        Reenviar en {smsResendCountdown}s
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSendSmsOTP}
                        disabled={sendSmsOTP.isPending}
                        className="w-full text-xs text-primary font-medium text-center disabled:opacity-60"
                      >
                        Reenviar código
                      </button>
                    )}
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* Puntos y estadísticas */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50 mb-4">
            Mis estadísticas
          </h2>
          {statsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
              ))}
            </div>
          ) : publicProfile ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-xl bg-primary/5 border border-primary/20">
                <p className="text-2xl font-bold text-primary">{publicProfile.total_points}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Puntos</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-primary/5 border border-primary/20">
                <p className="text-2xl font-bold text-primary">{publicProfile.total_reports}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Reportes</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-primary/5 border border-primary/20">
                <p className="text-2xl font-bold text-primary">{publicProfile.found_count}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Encontradas</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-primary/5 border border-primary/20">
                <p className="text-2xl font-bold text-primary">{publicProfile.share_count}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Compartidas</p>
              </div>
            </div>
          ) : null}
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
