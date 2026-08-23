import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PetIdentityFields } from '../PetIdentityFields';
import { Icon } from '../Icon';
import { FormSection } from '../form/FormSection';
import { FormField } from '../form/FormField';
import { FormActions, formSubmitClass } from '../form/FormActions';
import { composeBirthDate } from '@shared/utils/petBirthDate';
import type { AdoptionFormState } from '../../pages/PublishWizardPage';
import type { PetType } from '@shared/types';

interface AdoptionFormStepProps {
  value: AdoptionFormState;
  onChange: (value: AdoptionFormState) => void;
  onSubmit: () => void;
  isPending: boolean;
}

const MAX_PHOTOS = 3;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface FieldErrors {
  photo?: string;
  type?: string;
  city?: string;
  birthDate?: string;
}

// Mirrors StrayFormStep.tsx's shape (photos + type + breed + color + description),
// minus the location step and contact-opt-in, plus a required `city` field —
// adoption pets are owner-based and have no location report.
export function AdoptionFormStep({ value, onChange, onSubmit, isPending }: AdoptionFormStepProps) {
  const { t } = useTranslation(['publish', 'pets']);
  // `adoption` is a web-only namespace (not `publish`), so a dedicated `t`
  // bound to it is used for the adoption-specific strings (city, submit).
  const { t: tAdoption } = useTranslation('adoption');
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

  const handleSubmit = () => {
    const nextErrors: FieldErrors = {};
    if (value.photos.length === 0) nextErrors.photo = t('strayForm.photoRequired');
    if (!value.type) nextErrors.type = t('strayForm.typeRequired');
    if (!value.city.trim()) nextErrors.city = tAdoption('publish.cityRequired');
    // Si eligio un anio y el par no se pudo armar, se AVISA en vez de publicar
    // sin fecha y en silencio. Hoy la oferta acotada de meses y dias hace que
    // esto sea inalcanzable, asi que es red — pero CreatePetPage toma la misma
    // decision para el mismo input, y que dos pantallas elijan lo opuesto ante
    // el mismo caso es como una de las dos termina equivocada.
    if (value.identity.birth.year && !composeBirthDate(value.identity.birth)) {
      nextErrors.birthDate = t('pets:create.birthDateInvalid');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onSubmit();
  };

  return (
    // El paso NO usa FormPage: el frame lo pone PublishWizardPage. Ver la nota
    // equivalente en StrayFormStep.
    <div className="space-y-6">
      <h1 className="font-display text-headline text-gray-900 dark:text-gray-50 text-center">
        {tAdoption('publish.title')}
      </h1>

      <FormSection
        title={t('strayForm.sectionPhotos')}
        badge={`${value.photos.length}/${MAX_PHOTOS}`}
      >
        <FormField
          label={t('strayForm.photoLabel')}
          htmlFor="adoption-photo"
          required
          error={errors.photo}
        >
          {(control) => (
            <input
              {...control}
              /* Sin la clase de control de texto: la caja del input de archivo
                 la dibuja el navegador. Ver StrayFormStep. */
              className="block w-full text-sm text-gray-500 dark:text-gray-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-semibold
                file:bg-primary file:text-white
                hover:file:bg-primary-dark
                disabled:opacity-40 disabled:cursor-not-allowed
                cursor-pointer"
              ref={fileInputRef}
              data-testid="adoption-photo-input"
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
        htmlFor="adoption-type"
        required
        error={errors.type}
      >
        {(control) => (
          <select
            {...control}
            data-testid="adoption-type-select"
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

      {/* disabled durante el envio: buildAdoptionPayload congela `identity` al
          hacer click, pero createPet mas hasta 3 subidas de foto siguen
          corriendo segundos despues. Sin esto el usuario puede cambiar el sexo
          en esa ventana: la pantalla muestra "Hembra" y la mascota se creo
          "Macho", sin error y sin forma de notarlo. */}
      <PetIdentityFields
        value={value.identity}
        onChange={(identity) => onChange({ ...value, identity })}
        disabled={isPending}
        birthDateError={errors.birthDate}
      />

          {/* Raza y color en una fila: dos campos cortos y opcionales. */}
          <div className="grid sm:grid-cols-2 gap-6">
            <FormField label={t('strayForm.breedLabel')} htmlFor="adoption-breed">
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={value.breed}
                  onChange={(e) => onChange({ ...value, breed: e.target.value })}
                />
              )}
            </FormField>

            <FormField label={t('strayForm.colorLabel')} htmlFor="adoption-color">
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

          <FormField label={t('strayForm.descriptionLabel')} htmlFor="adoption-description">
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

      {/* La ciudad es obligatoria y va en su propia card: una mascota en
          adopción no tiene reporte de ubicación, así que la ciudad es el único
          dato con el que un adoptante puede filtrarla o encontrarla.
          Sin título de sección a propósito — con un solo campo, el encabezado
          repetiría palabra por palabra la etiqueta que está justo debajo. */}
      <FormSection>
        <FormField
          label={tAdoption('publish.cityLabel')}
          htmlFor="adoption-city"
          required
          error={errors.city}
        >
          {(control) => (
            <input
              {...control}
              type="text"
              placeholder={tAdoption('publish.cityPlaceholder')}
              value={value.city}
              onChange={(e) => onChange({ ...value, city: e.target.value })}
            />
          )}
        </FormField>
      </FormSection>

      <FormActions
        submit={
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className={formSubmitClass}
          >
            {tAdoption('publish.submit')}
          </button>
        }
      />
    </div>
  );
}
