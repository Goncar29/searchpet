import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyFosterHome, useRegisterFosterHome, useVerificationStatus } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { AnimalKind, HousingType } from '@shared/types';
import { Icon } from '../components/Icon';
import { FormPage } from '../components/form/FormPage';
import { FormSection } from '../components/form/FormSection';
import { FormField } from '../components/form/FormField';
import { FormActions, formSubmitClass } from '../components/form/FormActions';
import { FormChoiceGroup } from '../components/form/FormChoiceGroup';

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
    <FormPage title={t('fosterHomes:register.title')}>
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
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <FormSection title={t('fosterHomes:register.sectionHome')}>
            <div className="space-y-6">
              {/* Ciudad y capacidad en una fila: dos campos cortos, igual que
                  ciudad/teléfono en el registro de refugios. */}
              <div className="grid sm:grid-cols-2 gap-6">
                <Field
                  id="fh-city"
                  label={t('fosterHomes:register.city')}
                  value={form.city}
                  onChange={setField('city')}
                  error={fieldErrors.city}
                  maxLength={CITY_MAX_LEN}
                  required
                />
                <Field
                  id="fh-capacity"
                  label={t('fosterHomes:register.capacity')}
                  value={form.capacity}
                  onChange={setField('capacity')}
                  error={fieldErrors.capacity}
                  type="number"
                  required
                />
              </div>

              <FormChoiceGroup
                id="fh-housing"
                type="radio"
                legend={t('fosterHomes:register.housingType')}
                options={HOUSING_TYPES.map((ht) => ({
                  value: ht,
                  label: t(`fosterHomes:housingType.${ht}`),
                }))}
                value={form.housing_type}
                onToggle={(ht) => setForm((f) => ({ ...f, housing_type: ht }))}
              />

              <FormChoiceGroup
                id="fh-animals"
                type="checkbox"
                legend={t('fosterHomes:register.animalTypes')}
                options={ANIMAL_TYPES.map((kind) => ({
                  value: kind,
                  label: t(`fosterHomes:animalType.${kind}`),
                }))}
                value={form.animal_types}
                onToggle={toggleAnimalType}
                required
                requiredLabel={t('fosterHomes:register.required')}
                error={fieldErrors.animal_types}
              />
            </div>
          </FormSection>

          <FormSection title={t('fosterHomes:register.sectionContact')}>
            <div className="space-y-6">
              <FormField
                label={t('fosterHomes:register.description')}
                htmlFor="fh-description"
                required
                error={fieldErrors.description}
              >
                {(control) => (
                  <>
                    <textarea
                      {...control}
                      className={`${control.className} resize-y`}
                      value={form.description}
                      onChange={setField('description')}
                      rows={4}
                      maxLength={DESCRIPTION_MAX_LEN}
                    />
                    {/* El contador va DENTRO del render prop y después del
                        control, no en una fila propia junto al error: la
                        primitiva ya dibuja el error debajo, y sacarlo de ahí
                        para compartir renglón le quitaría el `role="alert"` y
                        el `aria-describedby` que lo conectan con el campo. */}
                    <p className="mt-1 text-right text-xs text-gray-400 dark:text-gray-500">
                      {form.description.length}/{DESCRIPTION_MAX_LEN}
                    </p>
                  </>
                )}
              </FormField>

              <Field
                id="fh-whatsapp"
                label={t('fosterHomes:register.whatsapp')}
                value={form.whatsapp_phone}
                onChange={setField('whatsapp_phone')}
                maxLength={WHATSAPP_MAX_LEN}
              />
            </div>
          </FormSection>

          {apiError && <p role="alert" className="text-sm text-danger">{apiError}</p>}

          <FormActions
            submit={
              <button type="submit" disabled={registerFosterHome.isPending} className={formSubmitClass}>
                {registerFosterHome.isPending
                  ? t('fosterHomes:register.submitting')
                  : t('fosterHomes:register.submit')}
              </button>
            }
          />
        </form>
      )}

      {step === 'done' && (
        <div className="text-center py-8">
          {/* `Icon` y no el emoji 🏠: un lector de pantalla lo anuncia por su
              nombre Unicode ("house"), y el par del refugio ya usa el icono. */}
          <Icon name="home" className="mx-auto mb-4 block text-4xl text-primary" />
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
    </FormPage>
  );
}

/**
 * Envoltorio fino sobre `FormField` para los campos de texto de esta pantalla.
 *
 * Antes era un componente COMPLETO con su etiqueta, su clase de control y su
 * párrafo de error — una copia privada de lo que hace `FormField`, con otro
 * padding y sin nada del cableado de accesibilidad. Ahora sólo adapta la firma.
 */
function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
  maxLength,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  type?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <FormField label={label} htmlFor={id} error={error} required={required}>
      {(control) => (
        <input
          {...control}
          type={type}
          value={value}
          onChange={onChange}
          min={type === 'number' ? 1 : undefined}
          maxLength={maxLength}
        />
      )}
    </FormField>
  );
}
