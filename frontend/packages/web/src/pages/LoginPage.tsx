import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
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
  email?: string;
  password?: string;
}

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated, isLoading } = useAuth();

  // Set by ForgotPasswordPage after a successful reset. Without reading it the
  // user finishes the whole flow and lands on a bare form with no sign it worked.
  const notice = (location.state as { notice?: string } | null)?.notice;
  const {
    googleError,
    setGoogleError,
    googleLoading,
    showLocationStep,
    handleCredential,
    finishOnboarding,
  } = useGoogleSignIn();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    const returnUrl = searchParams.get('returnUrl') || '/';
    navigate(returnUrl, { replace: true });
    return null;
  }

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (!email.trim()) {
      errors.email = t('common:required');
    } else if (!EMAIL_REGEX.test(email)) {
      errors.email = t('common:emailInvalid');
    }
    if (!password) {
      errors.password = t('common:required');
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
      await login(email, password);
      const returnUrl = searchParams.get('returnUrl') || '/';
      navigate(returnUrl);
    } catch (err) {
      setApiError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t('auth:login.title')} subtitle={t('auth:login.subtitle')}>
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
            {notice && (
              <div
                role="status"
                className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm p-3 rounded-lg"
              >
                {notice}
              </div>
            )}

            {apiError && (
              <div role="alert" className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg">
                {apiError}
              </div>
            )}

            <AuthField
              label={t('auth:login.email')}
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
              label={t('auth:login.password')}
              type="password"
              icon="lock"
              autoComplete="current-password"
              value={password}
              error={fieldErrors.password}
              onChange={(next) => {
                setPassword(next);
                if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }}
              labelAction={
                <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                  {t('auth:forgotPassword.link')}
                </Link>
              }
            />

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-white font-semibold py-3 rounded-xl shadow-sm hover:bg-primary-dark transition-colors disabled:opacity-60"
            >
              {loading ? t('common:loading') : t('auth:login.submit')}
              {!loading && <Icon name="arrow-forward" className="h-5 w-5" />}
            </button>

            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              <Link to="/register" className="text-primary font-semibold hover:underline">
                {t('auth:login.noAccount')}
              </Link>
            </p>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
