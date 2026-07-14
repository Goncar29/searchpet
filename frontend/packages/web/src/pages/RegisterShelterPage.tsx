import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyShelter, useRegisterShelter, useVerificationStatus } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ShelterSteps } from '../components/ShelterSteps';

const HTTPS_RE = /^https:\/\/.+/;

type FormState = {
  name: string;
  city: string;
  phone: string;
  email: string;
  description: string;
  website_url: string;
  donation_url: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  city: '',
  phone: '',
  email: '',
  description: '',
  website_url: '',
  donation_url: '',
};

export function RegisterShelterPage() {
  const { t } = useTranslation(['shelters', 'errors', 'common']);
  const [step, setStep] = useState<'intro' | 'form' | 'done'>('intro');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  const { data: verification } = useVerificationStatus();
  const { data: myShelter } = useMyShelter();
  const registerShelter = useRegisterShelter();

  // Ya tiene refugio → esta página no aplica. GOTCHA: tras un submit exitoso la
  // invalidación repuebla useMyShelter — sin el guard de 'done' el redirect se
  // comería la pantalla de confirmación.
  if (myShelter && step !== 'done') {
    return <Navigate to="/shelters/mine" replace />;
  }

  const emailVerified = verification?.email_verified ?? false;

  const setField = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) errs.name = t('shelters:register.nameRequired');
    if (!form.city.trim()) errs.city = t('shelters:register.cityRequired');
    const website = form.website_url.trim();
    if (website && !HTTPS_RE.test(website)) errs.website_url = t('shelters:register.invalidUrl');
    const donation = form.donation_url.trim();
    if (donation && !HTTPS_RE.test(donation)) errs.donation_url = t('shelters:register.invalidUrl');
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    if (!validate()) return;
    registerShelter.mutate(
      {
        name: form.name.trim(),
        city: form.city.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        description: form.description.trim(),
        website_url: form.website_url.trim(),
        donation_url: form.donation_url.trim(),
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
        {t('shelters:register.title')}
      </h1>

      {step === 'intro' && (
        <div>
          <ShelterSteps />
          <div className="mt-6 space-y-2 text-sm text-gray-500 dark:text-gray-400">
            <p>{t('shelters:register.reviewNote')}</p>
            <p>{t('shelters:register.noMoneyNote')}</p>
          </div>
          {emailVerified ? (
            <button
              type="button"
              onClick={() => setStep('form')}
              className="mt-6 w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary-dark transition-colors"
            >
              {t('shelters:register.start')}
            </button>
          ) : (
            <div className="mt-6 rounded-xl border border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950 p-4 text-center">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
                {t('shelters:register.emailUnverified')}
              </p>
              <Link to="/profile" className="text-sm font-semibold text-primary hover:underline">
                {t('shelters:register.verifyEmailLink')}
              </Link>
            </div>
          )}
        </div>
      )}

      {step === 'form' && (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field id="shelter-name" label={t('shelters:register.name')} value={form.name} onChange={setField('name')} error={fieldErrors.name} />
          <Field id="shelter-city" label={t('shelters:register.city')} value={form.city} onChange={setField('city')} error={fieldErrors.city} />
          <Field id="shelter-phone" label={t('shelters:register.phone')} value={form.phone} onChange={setField('phone')} />
          <Field id="shelter-email" label={t('shelters:register.email')} value={form.email} onChange={setField('email')} type="email" />
          <div>
            <label htmlFor="shelter-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('shelters:register.description')}
            </label>
            <textarea
              id="shelter-description"
              value={form.description}
              onChange={setField('description')}
              rows={4}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <Field id="shelter-website" label={t('shelters:register.websiteUrl')} value={form.website_url} onChange={setField('website_url')} error={fieldErrors.website_url} />
          <Field id="shelter-donation" label={t('shelters:register.donationUrl')} value={form.donation_url} onChange={setField('donation_url')} error={fieldErrors.donation_url} />

          {apiError && <p className="text-sm text-red-600">{apiError}</p>}

          <button
            type="submit"
            disabled={registerShelter.isPending}
            className="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {registerShelter.isPending ? t('shelters:register.submitting') : t('shelters:register.submit')}
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="text-center py-8">
          <p className="text-4xl mb-4">🏠</p>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t('shelters:register.successTitle')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('shelters:register.successBody')}</p>
          <Link
            to="/shelters/mine"
            className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-primary-dark transition-colors"
          >
            {t('shelters:register.goToMine')}
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  type?: string;
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
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}
