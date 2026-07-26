import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { useAuth } from '../context/AuthContext';

/**
 * The Google sign-in flow shared by LoginPage and RegisterPage: exchange the ID
 * token for a session, then either drop the user into the app (returning user)
 * or show the location onboarding step (brand-new user).
 *
 * Both pages need this identical logic, so it lives here rather than being
 * duplicated — the two would drift apart on the first change otherwise.
 */
export function useGoogleSignIn() {
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithGoogle } = useAuth();

  const [googleError, setGoogleError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showLocationStep, setShowLocationStep] = useState(false);

  const goToApp = useCallback(() => {
    navigate(searchParams.get('returnUrl') || '/', { replace: true });
  }, [navigate, searchParams]);

  const handleCredential = useCallback(
    async (idToken: string) => {
      setGoogleError('');
      setGoogleLoading(true);
      try {
        const isNewUser = await loginWithGoogle(idToken);
        if (isNewUser) {
          setShowLocationStep(true);
          return;
        }
        goToApp();
      } catch (err) {
        setGoogleError(getErrorMessage(err, t));
      } finally {
        setGoogleLoading(false);
      }
    },
    [loginWithGoogle, goToApp, t],
  );

  return {
    googleError,
    setGoogleError,
    googleLoading,
    showLocationStep,
    handleCredential,
    /** Called by LocationOnboardingStep when it is saved or skipped. */
    finishOnboarding: goToApp,
  };
}
