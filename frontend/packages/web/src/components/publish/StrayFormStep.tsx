import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PetIdentityFields } from '../PetIdentityFields';
import { Icon } from '../Icon';
import { FormSection } from '../form/FormSection';
import { FormField } from '../form/FormField';
import { FormActions, formSubmitClass } from '../form/FormActions';
import type { StrayFormState } from '../../pages/PublishWizardPage';
import type { PetType } from '@shared/types';

interface StrayFormStepProps {
  value: StrayFormState;
  onChange: (value: StrayFormState) => void;
  onNext: () => void;
}

const MAX_PHOTOS = 3;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface FieldErrors {
  photo?: string;
  type?: string;
}

export function StrayFormStep({ value, onChange, onNext }: StrayFormStepProps) {
  const { t } = useTranslation(['publish', 'pets']);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [previewURLs, setPreviewURLs] = useState<string[]>(() => value.photos.map((f) => URL.createObjectURL(f)));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewURLsRef = useRef(previewURLs);
  previewURLsRef.current = previewURLs;

  useEffect(() => {
    return () => {
      previewURLsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const atLimit = value.photos.length >= MAX_PHOTOS;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (incoming.length === 0) return;

    const slots = MAX_PHOTOS - value.photos.length;
    if (slots <= 0) return;

    const candidates = incoming.slice(0, slots);
    const validFiles: File[] = [];
    const newURLs: string[] = [];
    let formatOrSizeError: string | undefined;

    for (const file of candidates) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        formatOrSizeError = t('strayForm.photoFormatError');
        continue;
      }
      if (file.size > MAX_SIZE) {
        formatOrSizeError = t('strayForm.photoSizeError');
        continue;
      }
      validFiles.push(file);
      newURLs.push(URL.createObjectURL(file));
    }

    if (validFiles.length > 0) {
      onChange({ ...value, photos: [...value.photos, ...validFiles] });
      setPreviewURLs((prev) => [...prev, ...newURLs]);
      setErrors((prev) => ({ ...prev, photo: undefined }));
    }
    if (formatOrSizeError) {
      setErrors((prev) => ({ ...prev, photo: formatOrSizeError }));
    }
  };

  const removePhoto = (index: number) => {
    setPreviewURLs((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
    onChange({ ...value, photos: value.photos.filter((_, i) => i !== index) });
  };

  const handleNext = () => {
    const nextErrors: FieldErrors = {};
    if (value.photos.length === 0) nextErrors.photo = t('strayForm.photoRequired');
    if (!value.type) nextErrors.type = t('strayForm.typeRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onNext();
  };

  return (
    // El paso NO usa FormPage: es un paso de un wizard, no una página, y el
    // frame (el botón de volver, el reseteo del borrador) ya lo pone
    // PublishWizardPage. Meter FormPage acá dejaría dos componentes peleando
    // por quién dibuja el encabezado.
    <div className="space-y-6">
      <h1 className="font-display text-headline text-gray-900 dark:text-gray-50 text-center">
        {t('strayForm.title')}
      </h1>

      <FormSection
        title={t('strayForm.sectionPhotos')}
        badge={`${value.photos.length}/${MAX_PHOTOS}`}
      >
        <FormField
          label={t('strayForm.photoLabel')}
          htmlFor="stray-photo"
          required
          error={errors.photo}
        >
          {(control) => (
            <input
              {...control}
              /* El input de archivo NO lleva la clase de control de texto: su
                 caja la dibuja el navegador y `px-6 py-4` la deforma. Del
                 spread conserva lo que importa — el id y el cableado de aria. */
              className="block w-full text-sm text-gray-500 dark:text-gray-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-semibold
                file:bg-primary file:text-white
                hover:file:bg-primary-dark
                disabled:opacity-40 disabled:cursor-not-allowed
                cursor-pointer"
              ref={fileInputRef}
              data-testid="stray-photo-input"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={atLimit}
              onChange={handleFileChange}
            />
          )}
        </FormField>

        {atLimit && (
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            {t('strayForm.photoLimit')}
          </p>
        )}

        {previewURLs.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3">
            {previewURLs.map((url, i) => (
              <div key={i} className="relative">
                <img
                  src={url}
                  alt={`preview-${i}`}
                  className="h-24 w-24 object-cover rounded-xl border border-gray-200 dark:border-gray-700"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white text-xs flex items-center justify-center leading-none hover:opacity-90"
                  aria-label={t('strayForm.removePhoto')}
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <FormSection title={t('strayForm.sectionIdentity')}>
        <div className="space-y-6">
          <FormField
            label={t('strayForm.typeLabel')}
            htmlFor="stray-type"
            required
            error={errors.type}
          >
            {(control) => (
              <select
                {...control}
                data-testid="stray-type-select"
                value={value.type}
                onChange={(e) => onChange({ ...value, type: e.target.value as PetType })}
              >
                <option value="">—</option>
                <option value="perro">{t('pets:types.perro')}</option>
                <option value="gato">{t('pets:types.gato')}</option>
                <option value="pajaro">{t('pets:types.pajaro')}</option>
                <option value="otro">{t('pets:types.otro')}</option>
              </select>
            )}
          </FormField>

          <PetIdentityFields
            value={value.identity}
            onChange={(identity) => onChange({ ...value, identity })}
            hideBirthDate
          />

          {/* Raza y color conviven en una fila: son dos campos cortos y
              opcionales, y apilarlos alargaba la card sin ganar nada. */}
          <div className="grid sm:grid-cols-2 gap-6">
            <FormField label={t('strayForm.breedLabel')} htmlFor="stray-breed">
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={value.breed}
                  onChange={(e) => onChange({ ...value, breed: e.target.value })}
                />
              )}
            </FormField>

            <FormField label={t('strayForm.colorLabel')} htmlFor="stray-color">
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={value.color}
                  onChange={(e) => onChange({ ...value, color: e.target.value })}
                />
              )}
            </FormField>
          </div>

          <FormField label={t('strayForm.descriptionLabel')} htmlFor="stray-description">
            {(control) => (
              <textarea
                {...control}
                className={`${control.className} resize-y`}
                value={value.description}
                onChange={(e) => onChange({ ...value, description: e.target.value })}
                rows={3}
              />
            )}
          </FormField>
        </div>
      </FormSection>

      {/* Opt-in del contacto — expone el WhatsApp de quien reporta para que
          alguien sin sesión pueda escribirle. Apagado por defecto (privacidad). */}
      <FormSection title={t('strayForm.sectionContact')}>
        <div className="flex items-start gap-3">
          <input
            id="stray-contact-public"
            type="checkbox"
            checked={value.contactPublic}
            onChange={(e) => onChange({ ...value, contactPublic: e.target.checked })}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <label
            htmlFor="stray-contact-public"
            className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
          >
            {t('strayForm.contactPublicLabel')}
          </label>
        </div>
      </FormSection>

      <FormActions
        submit={
          <button type="button" onClick={handleNext} className={formSubmitClass}>
            {t('strayForm.next')}
          </button>
        }
      />
    </div>
  );
}
