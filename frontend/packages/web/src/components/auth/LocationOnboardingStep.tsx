import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';

interface LocationOnboardingStepProps {
  /** Called once the step is over — saved, skipped, or failed. Never blocks. */
  onDone: () => void;
}

/**
 * Post-signup location capture for brand-new Google users.
 *
 * Geolocation is the point of the product (PostGIS proximity search), but it is
 * NOT a gate: the user model allows null coordinates, so anyone who skips ends up
 * exactly like a user who never set a location and can fix it later from their
 * profile. A failed save also finishes the step — a network error at this point
 * must not trap someone inside a signup they already completed.
 */
export function LocationOnboardingStep({ onDone }: LocationOnboardingStepProps) {
  const { t } = useTranslation(['auth', 'common']);
  const [showCityFallback, setShowCityFallback] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (payload: { latitude?: number; longitude?: number; city?: string }) => {
    setSaving(true);
    try {
      await apiClient.updateMyLocation(payload);
    } catch {
      // Intencional: la ubicación es opcional. Un fallo acá no puede dejar al
      // usuario atrapado en un alta que ya se completó.
    } finally {
      setSaving(false);
      onDone();
    }
  };

  const requestGeolocation = () => {
    if (!navigator.geolocation) {
      setShowCityFallback(true);
      return;
    }
    setSaving(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSaving(false);
        void save({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        setSaving(false);
        setPermissionDenied(true);
        setShowCityFallback(true);
      },
      { timeout: 10_000 },
    );
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('auth:location.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('auth:location.subtitle')}</p>
      </div>

      {permissionDenied && (
        <p className="bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-sm p-3 rounded-lg">
          {t('auth:location.permissionDenied')}
        </p>
      )}

      {!showCityFallback && (
        <button
          type="button"
          onClick={requestGeolocation}
          disabled={saving}
          className="w-full bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
        >
          {saving ? t('common:loading') : t('auth:location.useMyLocation')}
        </button>
      )}

      {showCityFallback && (
        <div>
          <label htmlFor="onboarding-city" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('auth:location.cityLabel')}
          </label>
          <input
            id="onboarding-city"
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t('auth:location.cityPlaceholder')}
            className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <button
            type="button"
            onClick={() => void save({ city: city.trim() })}
            disabled={saving || city.trim() === ''}
            className="w-full mt-3 bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
          >
            {saving ? t('common:loading') : t('auth:location.saveCity')}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        disabled={saving}
        className="w-full text-sm text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-60"
      >
        {t('auth:location.skip')}
      </button>
    </div>
  );
}
