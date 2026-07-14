import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyShelter, useUpdateMyShelter } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ShelterSteps, type ShelterStepKey } from '../components/ShelterSteps';
import type { MyShelter } from '@shared/types';

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

// Estado → paso activo del stepper: rejected vuelve a "datos" (hay que corregir),
// pending resalta "revisión", approved resalta "publicado".
const STEP_BY_STATUS: Record<MyShelter['status'], ShelterStepKey> = {
  rejected: 'data',
  pending: 'review',
  approved: 'live',
};

export function MyShelterPage() {
  const { t } = useTranslation(['shelters', 'errors', 'common']);
  const { data: shelter, isLoading, isError, error, refetch } = useMyShelter();
  const updateShelter = useUpdateMyShelter();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (shelter) {
      setForm({
        name: shelter.name,
        city: shelter.city,
        phone: shelter.phone ?? '',
        email: shelter.email ?? '',
        description: shelter.description ?? '',
        website_url: shelter.website_url ?? '',
        donation_url: shelter.donation_url ?? '',
      });
    }
  }, [shelter]);

  const setField = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  // 404 shelter_not_found = todavía no registró — NO es un error (PR #82 pattern:
  // estados distintos para "vacío esperado" y "falló el fetch").
  if (isError && (error as { code?: string } | null)?.code === 'shelter_not_found') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          {t('shelters:mine.noShelterTitle')}
        </h1>
        <Link
          to="/shelters/register"
          className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-primary-dark transition-colors"
        >
          {t('shelters:mine.registerNow')}
        </Link>
      </div>
    );
  }

  if (isError || !shelter) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-red-500 dark:text-red-400 mb-4">{t('shelters:mine.loadError')}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-sm font-semibold text-primary border border-primary px-4 py-2 rounded-lg hover:bg-primary/5"
        >
          {t('shelters:mine.retry')}
        </button>
      </div>
    );
  }

  const hasStagedLink = shelter.pending_donation_url !== undefined || shelter.pending_website_url !== undefined;
  const isApproved = shelter.status === 'approved';
  const isRejected = shelter.status === 'rejected';

  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) errs.name = t('shelters:register.nameRequired');
    if (!form.city.trim()) errs.city = t('shelters:register.cityRequired');
    const website = form.website_url.trim();
    const donation = form.donation_url.trim();
    if (website && !HTTPS_RE.test(website)) errs.website_url = t('shelters:register.invalidUrl');
    if (donation && !HTTPS_RE.test(donation)) errs.donation_url = t('shelters:register.invalidUrl');
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    if (!validate()) return;
    // Regla #22: mandamos TODOS los campos, incluso "" (vaciar). El backend
    // distingue nil (no enviado) de "" (limpiar) con punteros.
    updateShelter.mutate(
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
        onSuccess: () => setSaved(true),
        onError: (err) => setApiError(getErrorMessage(err, t)),
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('shelters:mine.title')}</h1>

      <ShelterSteps active={STEP_BY_STATUS[shelter.status]} />

      {isApproved && (
        <p className="mt-4 text-sm font-semibold text-green-600 dark:text-green-400">
          {t('shelters:mine.approvedTitle')}
        </p>
      )}

      {isRejected && (
        <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-4">
          <p className="font-semibold text-red-700 dark:text-red-300">{t('shelters:mine.rejectedTitle')}</p>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            {t('shelters:mine.rejectedReason', { reason: shelter.rejection_reason })}
          </p>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">{t('shelters:mine.resubmitHint')}</p>
        </div>
      )}

      {isApproved && hasStagedLink && (
        <span className="inline-block mt-4 text-xs font-semibold text-yellow-800 dark:text-yellow-200 bg-yellow-100 dark:bg-yellow-900 rounded-full px-3 py-1">
          {t('shelters:mine.linkPendingBadge')}
        </span>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <EditField id="mine-name" label={t('shelters:register.name')} value={form.name} onChange={setField('name')} error={fieldErrors.name} />
        <EditField id="mine-city" label={t('shelters:register.city')} value={form.city} onChange={setField('city')} error={fieldErrors.city} />
        <EditField id="mine-phone" label={t('shelters:register.phone')} value={form.phone} onChange={setField('phone')} />
        <EditField id="mine-email" label={t('shelters:register.email')} value={form.email} onChange={setField('email')} type="email" />
        <div>
          <label htmlFor="mine-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('shelters:register.description')}
          </label>
          <textarea
            id="mine-description"
            value={form.description}
            onChange={setField('description')}
            rows={4}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {isApproved && (
          <p className="text-sm text-yellow-800 dark:text-yellow-200 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-900 rounded-xl p-3">
            {t('shelters:mine.linkReviewWarning')}
          </p>
        )}
        <EditField id="mine-website" label={t('shelters:register.websiteUrl')} value={form.website_url} onChange={setField('website_url')} error={fieldErrors.website_url} />
        <EditField id="mine-donation" label={t('shelters:register.donationUrl')} value={form.donation_url} onChange={setField('donation_url')} error={fieldErrors.donation_url} />

        {apiError && <p className="text-sm text-red-600">{apiError}</p>}
        {saved && <p role="status" className="text-sm text-green-600 dark:text-green-400">{t('shelters:mine.saved')}</p>}

        <button
          type="submit"
          disabled={updateShelter.isPending}
          className="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {updateShelter.isPending
            ? t('shelters:mine.saving')
            : isRejected
              ? t('shelters:mine.resubmit')
              : t('shelters:mine.save')}
        </button>
      </form>
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
