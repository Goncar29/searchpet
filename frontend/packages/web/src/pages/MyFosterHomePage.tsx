import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  useMyFosterHome,
  useUpdateMyFosterHome,
  useUploadFosterHomePhoto,
  useDeleteFosterHomePhoto,
} from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { AnimalKind, FosterHomeStatus, HousingType } from '@shared/types';

const HOUSING_TYPES: HousingType[] = ['house', 'apartment'];
const ANIMAL_TYPES: AnimalKind[] = ['dog', 'cat', 'other'];
const MAX_PHOTOS = 5;

type FormState = {
  city: string;
  housing_type: HousingType;
  animal_types: AnimalKind[];
  capacity: string;
  description: string;
  whatsapp_phone: string;
};

const EMPTY_FORM: FormState = {
  city: '',
  housing_type: 'house',
  animal_types: [],
  capacity: '1',
  description: '',
  whatsapp_phone: '',
};

// Deben coincidir con los límites del backend (foster_home_dto.go) y del form de registro.
const CITY_MAX_LEN = 100;
const DESCRIPTION_MAX_LEN = 500;
const WHATSAPP_MAX_LEN = 20;

type FieldErrorKey = 'city' | 'animal_types' | 'capacity' | 'description';

// status → key del mensaje en fosterHomes:mine.*  (mismo patrón que la label
// de estado, que usa fosterHomes:status.<status> directamente).
const STATUS_MESSAGE_KEY: Record<FosterHomeStatus, string> = {
  pending: 'fosterHomes:mine.statusPending',
  approved: 'fosterHomes:mine.statusApproved',
  rejected: 'fosterHomes:mine.statusRejected',
  suspended: 'fosterHomes:mine.statusSuspended',
};

export function MyFosterHomePage() {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);
  const { data: fosterHome, isLoading, isError, error, refetch } = useMyFosterHome();
  const updateFosterHome = useUpdateMyFosterHome();
  const uploadPhoto = useUploadFosterHomePhoto();
  const deletePhoto = useDeleteFosterHomePhoto();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldErrorKey, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fosterHome) {
      setForm({
        city: fosterHome.city,
        housing_type: fosterHome.housing_type,
        animal_types: fosterHome.animal_types,
        capacity: String(fosterHome.capacity),
        description: fosterHome.description ?? '',
        whatsapp_phone: fosterHome.whatsapp_phone ?? '',
      });
    }
  }, [fosterHome]);

  const setField = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const toggleAnimalType = (kind: AnimalKind) => {
    setSaved(false);
    setForm((f) => ({
      ...f,
      animal_types: f.animal_types.includes(kind)
        ? f.animal_types.filter((k) => k !== kind)
        : [...f.animal_types, kind],
    }));
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  // 404 foster_home_not_found = todavía no registró — NO es un error (mismo
  // patrón que MyShelterPage: "vacío esperado" vs "falló el fetch").
  if (isError && (error as { code?: string } | null)?.code === 'foster_home_not_found') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          {t('fosterHomes:mine.noFosterHomeTitle')}
        </h1>
        <Link
          to="/fosterhomes/register"
          className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-primary-dark transition-colors"
        >
          {t('fosterHomes:mine.registerNow')}
        </Link>
      </div>
    );
  }

  if (isError || !fosterHome) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-red-500 dark:text-red-400 mb-4">{t('fosterHomes:mine.loadError')}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-sm font-semibold text-primary border border-primary px-4 py-2 rounded-lg hover:bg-primary/5"
        >
          {t('fosterHomes:mine.retry')}
        </button>
      </div>
    );
  }

  const isSuspended = fosterHome.status === 'suspended';
  const isRejected = fosterHome.status === 'rejected';
  const isApproved = fosterHome.status === 'approved';
  const photoCount = fosterHome.photos.length;
  const canAddPhoto = photoCount < MAX_PHOTOS;

  const validate = (): boolean => {
    const errs: Partial<Record<FieldErrorKey, string>> = {};
    if (!form.city.trim()) errs.city = t('fosterHomes:register.cityRequired');
    else if (form.city.length > CITY_MAX_LEN) errs.city = t('fosterHomes:register.maxLengthError', { max: CITY_MAX_LEN });
    if (form.animal_types.length === 0) errs.animal_types = t('fosterHomes:register.animalTypesRequired');
    const capacityNum = Number(form.capacity);
    if (!Number.isInteger(capacityNum) || capacityNum < 1) errs.capacity = t('fosterHomes:register.capacityInvalid');
    if (!form.description.trim()) errs.description = t('fosterHomes:register.descriptionRequired');
    else if (form.description.length > DESCRIPTION_MAX_LEN)
      errs.description = t('fosterHomes:register.maxLengthError', { max: DESCRIPTION_MAX_LEN });
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setSaved(false);
    // Defensa cliente: un hogar suspendido no se puede editar. El backend
    // igual devuelve 409 foster_home_suspended si esto se saltea — se
    // maneja abajo vía getErrorMessage (defense in depth, no solo UI).
    if (isSuspended) return;
    if (!validate()) return;
    updateFosterHome.mutate(
      {
        city: form.city.trim(),
        housing_type: form.housing_type,
        animal_types: form.animal_types,
        capacity: Number(form.capacity),
        description: form.description.trim(),
        whatsapp_phone: form.whatsapp_phone.trim(),
      },
      {
        onSuccess: () => setSaved(true),
        onError: (err) => setApiError(getErrorMessage(err, t)),
      }
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setPhotoError(null);
    try {
      await uploadPhoto.mutateAsync(file);
    } catch (err) {
      // Cubre too_many_photos (422) si hubo una carrera con otra pestaña.
      setPhotoError(getErrorMessage(err, t));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    setPhotoError(null);
    setDeletingPhotoId(photoId);
    try {
      await deletePhoto.mutateAsync(photoId);
    } catch (err) {
      setPhotoError(getErrorMessage(err, t));
    } finally {
      setDeletingPhotoId(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('fosterHomes:mine.title')}</h1>

      <div
        className={
          isApproved
            ? 'rounded-xl border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 p-4'
            : isRejected || isSuspended
              ? 'rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-4'
              : 'rounded-xl border border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950 p-4'
        }
      >
        <p
          className={
            isApproved
              ? 'font-semibold text-green-700 dark:text-green-300'
              : isRejected || isSuspended
                ? 'font-semibold text-red-700 dark:text-red-300'
                : 'font-semibold text-yellow-800 dark:text-yellow-200'
          }
        >
          {t(`fosterHomes:status.${fosterHome.status}`)}
        </p>
        <p
          className={
            isApproved
              ? 'text-sm text-green-600 dark:text-green-400 mt-1'
              : isRejected || isSuspended
                ? 'text-sm text-red-600 dark:text-red-400 mt-1'
                : 'text-sm text-yellow-700 dark:text-yellow-300 mt-1'
          }
        >
          {t(STATUS_MESSAGE_KEY[fosterHome.status])}
        </p>
        {isRejected && fosterHome.rejection_reason && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            <span className="font-semibold">{t('fosterHomes:mine.rejectionReason')}:</span>{' '}
            {fosterHome.rejection_reason}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
        <fieldset disabled={isSuspended} className="space-y-5 disabled:opacity-60">
          <EditField
            id="mine-city"
            label={t('fosterHomes:register.city')}
            value={form.city}
            onChange={setField('city')}
            error={fieldErrors.city}
            maxLength={CITY_MAX_LEN}
          />

          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('fosterHomes:register.housingType')}
            </span>
            <div className="flex gap-4">
              {HOUSING_TYPES.map((ht) => (
                <label key={ht} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="housing_type"
                    value={ht}
                    checked={form.housing_type === ht}
                    onChange={() => {
                      setSaved(false);
                      setForm((f) => ({ ...f, housing_type: ht }));
                    }}
                    disabled={isSuspended}
                    className="text-primary focus:ring-primary"
                  />
                  {t(`fosterHomes:housingType.${ht}`)}
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('fosterHomes:register.animalTypes')}
            </span>
            <div className="flex flex-wrap gap-4">
              {ANIMAL_TYPES.map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={form.animal_types.includes(kind)}
                    onChange={() => toggleAnimalType(kind)}
                    disabled={isSuspended}
                    className="rounded text-primary focus:ring-primary"
                  />
                  {t(`fosterHomes:animalType.${kind}`)}
                </label>
              ))}
            </div>
            {fieldErrors.animal_types && <p className="text-sm text-red-600 mt-1">{fieldErrors.animal_types}</p>}
          </div>

          <EditField
            id="mine-capacity"
            label={t('fosterHomes:register.capacity')}
            value={form.capacity}
            onChange={setField('capacity')}
            error={fieldErrors.capacity}
            type="number"
          />

          <div>
            <label htmlFor="mine-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('fosterHomes:register.description')}
            </label>
            <textarea
              id="mine-description"
              value={form.description}
              onChange={setField('description')}
              rows={4}
              maxLength={DESCRIPTION_MAX_LEN}
              disabled={isSuspended}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
            />
            <div className="flex justify-between mt-1">
              {fieldErrors.description ? (
                <p className="text-sm text-red-600">{fieldErrors.description}</p>
              ) : (
                <span />
              )}
              <span
                className={`text-xs ${form.description.length > DESCRIPTION_MAX_LEN ? 'text-red-600' : 'text-gray-400 dark:text-gray-500'
                  }`}
              >
                {form.description.length}/{DESCRIPTION_MAX_LEN}
              </span>
            </div>
          </div>

          <EditField
            id="mine-whatsapp"
            label={t('fosterHomes:register.whatsapp')}
            value={form.whatsapp_phone}
            onChange={setField('whatsapp_phone')}
            maxLength={WHATSAPP_MAX_LEN}
          />
        </fieldset>

        {isSuspended && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-3">
            {t('fosterHomes:mine.suspendedFrozen')}
          </p>
        )}

        {apiError && <p className="text-sm text-red-600">{apiError}</p>}
        {saved && (
          <p role="status" className="text-sm text-green-600 dark:text-green-400">
            {t('fosterHomes:mine.saved')}
          </p>
        )}

        {!isSuspended && (
          <button
            type="submit"
            disabled={updateFosterHome.isPending}
            className="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {updateFosterHome.isPending ? t('fosterHomes:mine.saving') : t('fosterHomes:mine.save')}
          </button>
        )}
      </form>

      {/* Fotos — retención por diseño: no hay botón de borrar el hogar (§18). */}
      <div className="mt-8">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">{t('fosterHomes:detail.photos')}</h2>

        {photoCount > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {fosterHome.photos.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700"
              >
                <img src={photo.url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => handleDeletePhoto(photo.id)}
                  disabled={deletingPhotoId === photo.id}
                  className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white text-xs font-semibold rounded-full px-2 py-1 disabled:opacity-50"
                >
                  {t('fosterHomes:mine.deletePhoto')}
                </button>
              </div>
            ))}
          </div>
        )}

        {photoError && <p className="text-sm text-red-600 mb-2">{photoError}</p>}

        {canAddPhoto ? (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              disabled={uploadPhoto.isPending}
              className="block w-full text-sm text-gray-500 dark:text-gray-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-semibold
                file:bg-primary file:text-white
                hover:file:bg-primary-dark
                cursor-pointer disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('fosterHomes:mine.photoLimit')}</p>
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('fosterHomes:mine.photoLimit')}</p>
        )}
      </div>
    </div>
  );
}

function EditField({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  type?: string;
  maxLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        min={type === 'number' ? 1 : undefined}
        maxLength={maxLength}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
      />
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}
