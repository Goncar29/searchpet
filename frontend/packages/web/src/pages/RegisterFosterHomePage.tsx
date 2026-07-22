import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyFosterHome, useRegisterFosterHome, useVerificationStatus } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { AnimalKind, HousingType } from '@shared/types';

const HOUSING_TYPES: HousingType[] = ['house', 'apartment'];
const ANIMAL_TYPES: AnimalKind[] = ['dog', 'cat', 'other'];

// Deben coincidir con los límites del backend (foster_home_dto.go).
const CITY_MAX_LEN = 100;
const DESCRIPTION_MAX_LEN = 500;
const WHATSAPP_MAX_LEN = 20;

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

type FieldErrorKey = 'city' | 'animal_types' | 'capacity' | 'description';

export function RegisterFosterHomePage() {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);
  const [step, setStep] = useState<'intro' | 'form' | 'done'>('intro');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldErrorKey, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  const { data: verification } = useVerificationStatus();
  const { data: myFosterHome } = useMyFosterHome();
  const registerFosterHome = useRegisterFosterHome();

  // Ya tiene hogar → esta página no aplica. GOTCHA (mismo patrón que
  // RegisterShelterPage): tras un submit exitoso la invalidación repuebla
  // useMyFosterHome — sin el guard de 'done' el redirect se comería la
  // pantalla de confirmación.
  if (myFosterHome && step !== 'done') {
    return <Navigate to="/fosterhomes/mine" replace />;
  }

  const emailVerified = verification?.email_verified ?? false;

  const setField = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggleAnimalType = (kind: AnimalKind) => {
    setForm((f) => ({
      ...f,
      animal_types: f.animal_types.includes(kind)
        ? f.animal_types.filter((k) => k !== kind)
        : [...f.animal_types, kind],
    }));
  };

  const validate = (): boolean => {
    const errs: Partial<Record<FieldErrorKey, string>> = {};
    if (!form.city.trim()) errs.city = t('fosterHomes:register.cityRequired');
    if (form.animal_types.length === 0) errs.animal_types = t('fosterHomes:register.animalTypesRequired');
    const capacityNum = Number(form.capacity);
    if (!Number.isInteger(capacityNum) || capacityNum < 1) errs.capacity = t('fosterHomes:register.capacityInvalid');
    if (!form.description.trim()) errs.description = t('fosterHomes:register.descriptionRequired');
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    if (!validate()) return;
    registerFosterHome.mutate(
      {
        city: form.city.trim(),
        housing_type: form.housing_type,
        animal_types: form.animal_types,
        capacity: Number(form.capacity),
        description: form.description.trim(),
        whatsapp_phone: form.whatsapp_phone.trim() || undefined,
      },
      {
        onSuccess: () => setStep('done'),
        onError: (err) => setApiError(getErrorMessage(err, t)),
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        {t('fosterHomes:register.title')}
      </h1>

      {step === 'intro' && (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('fosterHomes:register.intro')}</p>
          <div className="mt-6 space-y-2 text-sm text-gray-500 dark:text-gray-400">
            <p>{t('fosterHomes:register.reviewNote')}</p>
            <p>{t('fosterHomes:register.oneNote')}</p>
          </div>
          {emailVerified ? (
            <button
              type="button"
              onClick={() => setStep('form')}
              className="mt-6 w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary-dark transition-colors"
            >
              {t('fosterHomes:register.start')}
            </button>
          ) : (
            <div className="mt-6 rounded-xl border border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950 p-4 text-center">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
                {t('fosterHomes:register.emailUnverified')}
              </p>
              <Link to="/profile" className="text-sm font-semibold text-primary hover:underline">
                {t('fosterHomes:register.verifyEmailLink')}
              </Link>
            </div>
          )}
        </div>
      )}

      {step === 'form' && (
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <Field
            id="fh-city"
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
                    onChange={() => setForm((f) => ({ ...f, housing_type: ht }))}
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
                    className="rounded text-primary focus:ring-primary"
                  />
                  {t(`fosterHomes:animalType.${kind}`)}
                </label>
              ))}
            </div>
            {fieldErrors.animal_types && <p className="text-sm text-red-600 mt-1">{fieldErrors.animal_types}</p>}
          </div>

          <Field
            id="fh-capacity"
            label={t('fosterHomes:register.capacity')}
            value={form.capacity}
            onChange={setField('capacity')}
            error={fieldErrors.capacity}
            type="number"
          />

          <div>
            <label htmlFor="fh-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('fosterHomes:register.description')}
            </label>
            <textarea
              id="fh-description"
              value={form.description}
              onChange={setField('description')}
              rows={4}
              maxLength={DESCRIPTION_MAX_LEN}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex justify-between mt-1">
              {fieldErrors.description ? (
                <p className="text-sm text-red-600">{fieldErrors.description}</p>
              ) : (
                <span />
              )}
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {form.description.length}/{DESCRIPTION_MAX_LEN}
              </span>
            </div>
          </div>

          <Field
            id="fh-whatsapp"
            label={t('fosterHomes:register.whatsapp')}
            value={form.whatsapp_phone}
            onChange={setField('whatsapp_phone')}
            maxLength={WHATSAPP_MAX_LEN}
          />

          {apiError && <p className="text-sm text-red-600">{apiError}</p>}

          <button
            type="submit"
            disabled={registerFosterHome.isPending}
            className="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {registerFosterHome.isPending ? t('fosterHomes:register.submitting') : t('fosterHomes:register.submit')}
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="text-center py-8">
          <p className="text-4xl mb-4">🏠</p>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t('fosterHomes:register.successTitle')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('fosterHomes:register.successBody')}</p>
          <Link
            to="/fosterhomes/mine"
            className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-primary-dark transition-colors"
          >
            {t('fosterHomes:register.goToMine')}
          </Link>
        </div>
      )}
    </div>
  );
}

function Field({
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
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}
