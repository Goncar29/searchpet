import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { Icon } from '../components/Icon';
import { AuthField } from '../components/auth/AuthField';
import { AuthLayout } from '../components/auth/AuthLayout';
import { AUTH_CARD } from '../components/auth/authStyles';
import { GoogleAuthPanel } from '../components/auth/GoogleAuthPanel';
import { LocationOnboardingStep } from '../components/auth/LocationOnboardingStep';
import { useGoogleSignIn } from '../hooks/useGoogleSignIn';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export function RegisterPage() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const { register, isAuthenticated, isLoading } = useAuth();
  const {
    googleError,
    setGoogleError,
    googleLoading,
    showLocationStep,
    handleCredential,
    finishOnboarding,
  } = useGoogleSignIn();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  // Both exclusions are load-bearing. AuthContext.loginWithGoogle stores the
  // token — flipping isAuthenticated — BEFORE it resolves, so there is a render
  // where the user is authenticated but the page has not yet decided whether to
  // show onboarding. googleLoading covers that in-flight window; showLocationStep
  // covers the step itself. Without them this guard redirects away and the whole
  // new-user flow never renders.
  if (!isLoading && isAuthenticated && !googleLoading && !showLocationStep) {
    navigate('/', { replace: true });
    return null;
  }

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = t('common:required');
    if (!email.trim()) {
      errors.email = t('common:required');
    } else if (!EMAIL_REGEX.test(email)) {
      errors.email = t('common:emailInvalid');
    }
    if (!password) {
      errors.password = t('common:required');
    } else if (password.length < 6) {
      errors.password = t('auth:register.passwordMin');
    }
    if (!confirm) {
      errors.confirm = t('common:required');
    } else if (password !== confirm) {
      errors.confirm = t('auth:register.passwordMismatch');
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;
    setLoading(true);
    try {
      await register(email, password, name, phone || undefined, city || undefined);
      navigate('/');
    } catch (err) {
      setApiError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t('auth:register.title')} subtitle={t('auth:register.subtitle')}>
      {showLocationStep ? (
        <LocationOnboardingStep onDone={finishOnboarding} />
      ) : (
        <>
          <GoogleAuthPanel
            error={googleError}
            onCredential={handleCredential}
            onError={setGoogleError}
          />

          <form onSubmit={handleSubmit} noValidate className={`${AUTH_CARD} space-y-5`}>
            {apiError && (
              <div role="alert" className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg">
                {apiError}
              </div>
            )}

            <AuthField
              label={`${t('auth:register.name')} *`}
              type="text"
              icon="person"
              autoComplete="name"
              value={name}
              error={fieldErrors.name}
              onChange={(next) => {
                setName(next);
                if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }}
            />

            <AuthField
              label={`${t('auth:register.email')} *`}
              type="email"
              icon="mail"
              autoComplete="email"
              value={email}
              error={fieldErrors.email}
              onChange={(next) => {
                setEmail(next);
                if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
            />

            <AuthField
              label={t('auth:register.phone')}
              type="tel"
              icon="call"
              autoComplete="tel"
              value={phone}
              onChange={setPhone}
            />

            <AuthField
              label={t('auth:register.city')}
              type="text"
              icon="location-on"
              autoComplete="address-level2"
              placeholder="Ej: Montevideo, Buenos Aires..."
              value={city}
              onChange={setCity}
            />

            <AuthField
              label={`${t('auth:register.password')} *`}
              type="password"
              icon="lock"
              autoComplete="new-password"
              value={password}
              error={fieldErrors.password}
              onChange={(next) => {
                setPassword(next);
                if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }}
            />

            <AuthField
              label={`${t('auth:register.confirm')} *`}
              type="password"
              icon="lock"
              autoComplete="new-password"
              value={confirm}
              error={fieldErrors.confirm}
              onChange={(next) => {
                setConfirm(next);
                if (fieldErrors.confirm) setFieldErrors((prev) => ({ ...prev, confirm: undefined }));
              }}
            />

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-white font-semibold py-3 rounded-xl shadow-sm hover:bg-primary-dark transition-colors disabled:opacity-60"
            >
              {loading ? t('common:loading') : t('auth:register.submit')}
              {!loading && <Icon name="arrow-forward" className="h-5 w-5" />}
            </button>

            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              <Link to="/login" className="text-primary font-semibold hover:underline">
                {t('auth:register.hasAccount')}
              </Link>
            </p>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
