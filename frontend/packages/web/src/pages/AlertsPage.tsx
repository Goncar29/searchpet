import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAlerts,
  useCreateAlert,
  useUpdateAlert,
  useDeleteAlert,
} from '@shared/hooks';
import type { LocationAlert } from '@shared/types';
import type { PetType } from '@shared/types';

const PET_TYPES: PetType[] = ['perro', 'gato', 'pajaro', 'otro'];

const RADIUS_OPTIONS = [1, 2, 5, 10, 25] as const;
type RadiusKm = (typeof RADIUS_OPTIONS)[number];

const INPUT_CLASS =
  'border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary w-full';

const MAX_ALERTS = 10;

export function AlertsPage() {
  const { t } = useTranslation('alerts');
  const { data, isLoading } = useAlerts();
  const createAlert = useCreateAlert();
  const updateAlert = useUpdateAlert();
  const deleteAlert = useDeleteAlert();

  const alerts: LocationAlert[] = data ?? [];

  // ── Form state ──────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [radiusKm, setRadiusKm] = useState<RadiusKm>(5);
  const [petType, setPetType] = useState('');
  const [formLat, setFormLat] = useState<number | null>(null);
  const [formLng, setFormLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [coordError, setCoordError] = useState('');

  // Pre-fill coordinates from browser geolocation on mount
  useEffect(() => {
    if (navigator.geolocation) {
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFormLat(pos.coords.latitude);
          setFormLng(pos.coords.longitude);
          setLocating(false);
        },
        () => {
          setLocating(false);
        }
      );
    }
  }, []);

  const handleGeolocate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormLat(pos.coords.latitude);
        setFormLng(pos.coords.longitude);
        setLocating(false);
        setCoordError('');
      },
      () => {
        setLocating(false);
      }
    );
  };

  const resetForm = () => {
    setName('');
    setRadiusKm(5);
    setPetType('');
    setCoordError('');
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formLat === null || formLng === null) {
      setCoordError(t('coordError'));
      return;
    }
    setCoordError('');
    await createAlert.mutateAsync({
      latitude: formLat,
      longitude: formLng,
      radius_km: radiusKm,
      name: name.trim() || undefined,
      pet_type: petType || undefined,
    });
    resetForm();
  };

  const handleToggle = (alert: LocationAlert) => {
    updateAlert.mutate({ id: alert.id, data: { is_active: !alert.is_active } });
  };

  const handleDelete = (alert: LocationAlert) => {
    const label = alert.name ?? t('thisAlert');
    if (window.confirm(t('confirmDelete', { name: label }))) {
      deleteAlert.mutate(alert.id);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('title', { count: alerts.length, max: MAX_ALERTS })}
        </h1>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            disabled={alerts.length >= MAX_ALERTS}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('newAlert')}
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5 mb-6"
        >
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">{t('formTitle')}</h2>

          {/* Name */}
          <div className="mb-3">
            <label htmlFor="alert-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('nameLabel')}
            </label>
            <input
              id="alert-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder={t('namePlaceholder')}
              className={INPUT_CLASS}
            />
          </div>

          {/* Coordinates */}
          <div className="mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('coordsLabel')}
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                step="any"
                value={formLat ?? ''}
                onChange={(e) => setFormLat(e.target.value ? Number(e.target.value) : null)}
                placeholder={t('latPlaceholder')}
                aria-label={t('latPlaceholder')}
                className={INPUT_CLASS}
              />
              <input
                type="number"
                step="any"
                value={formLng ?? ''}
                onChange={(e) => setFormLng(e.target.value ? Number(e.target.value) : null)}
                placeholder={t('lngPlaceholder')}
                aria-label={t('lngPlaceholder')}
                className={INPUT_CLASS}
              />
              <button
                type="button"
                onClick={handleGeolocate}
                disabled={locating}
                className="shrink-0 px-3 py-2 text-xs font-semibold text-primary border border-primary rounded-lg hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors disabled:opacity-50"
              >
                {locating ? '...' : t('useMyLocation')}
              </button>
            </div>
          </div>
          {coordError && (
            <p className="text-red-500 text-sm mt-1 mb-2">{coordError}</p>
          )}

          {/* Radius chips */}
          <div className="mb-3 mt-3">
            <label id="alert-radius-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('radiusLabel')}
            </label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="alert-radius-label">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={radiusKm === r}
                  onClick={() => setRadiusKm(r)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    radiusKm === r
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-primary'
                  }`}
                >
                  {r} km
                </button>
              ))}
            </div>
          </div>

          {/* Pet type */}
          <div className="mb-4">
            <label htmlFor="alert-pet-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('petTypeLabel')}
            </label>
            <select
              id="alert-pet-type"
              value={petType}
              onChange={(e) => setPetType(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">{t('allTypes')}</option>
              {PET_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {t(`pets:types.${pt}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createAlert.isPending}
              className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {createAlert.isPending ? t('creating') : t('createButton')}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-5 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">{t('loading')}</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && alerts.length === 0 && !showForm && (
        <div className="text-center py-16">
          <p className="text-5xl mb-4">🔔</p>
          <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">{t('emptyTitle')}</p>
          <p className="text-gray-500 dark:text-gray-400 mb-4 text-sm">
            {t('emptyText')}
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors"
          >
            {t('createFirst')}
          </button>
        </div>
      )}

      {/* Alert list */}
      {!isLoading && alerts.length > 0 && (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-4 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {alert.name ?? t('unnamed')}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {alert.alert_latitude.toFixed(3)}, {alert.alert_longitude.toFixed(3)}
                  {' · '}{alert.radius_km} km
                  {alert.pet_type ? ` · ${t(`pets:types.${alert.pet_type}`)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={alert.is_active}
                    onChange={() => handleToggle(alert)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {alert.is_active ? t('active') : t('inactive')}
                  </span>
                </label>
                <button
                  onClick={() => handleDelete(alert)}
                  className="text-xs font-medium text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
