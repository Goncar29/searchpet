import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onSubmit();
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 text-center">
        {t('strayForm.title')}
      </h1>

      {/* Photos */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="adoption-photo" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('strayForm.photoLabel')}
          </label>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {value.photos.length}/{MAX_PHOTOS}
          </span>
        </div>
        <input
          ref={fileInputRef}
          id="adoption-photo"
          data-testid="adoption-photo-input"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={atLimit}
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-500 dark:text-gray-400
            file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0
            file:text-sm file:font-semibold
            file:bg-primary file:text-white
            hover:file:bg-primary-dark
            disabled:opacity-40 disabled:cursor-not-allowed
            cursor-pointer"
        />
        {atLimit && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('strayForm.photoLimit')}</p>}
        {errors.photo && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{errors.photo}</p>}
        {previewURLs.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {previewURLs.map((url, i) => (
              <div key={i} className="relative">
                <img src={url} alt={`preview-${i}`} className="h-24 w-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none hover:bg-red-600"
                  aria-label="Eliminar foto"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Type */}
      <div>
        <label htmlFor="adoption-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('strayForm.typeLabel')}
        </label>
        <select
          id="adoption-type"
          data-testid="adoption-type-select"
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value as PetType })}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">—</option>
          <option value="perro">{t('pets:types.perro')}</option>
          <option value="gato">{t('pets:types.gato')}</option>
          <option value="pajaro">{t('pets:types.pajaro')}</option>
          <option value="otro">{t('pets:types.otro')}</option>
        </select>
        {errors.type && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{errors.type}</p>}
      </div>

      {/* Breed */}
      <div>
        <label htmlFor="adoption-breed" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('strayForm.breedLabel')}
        </label>
        <input
          id="adoption-breed"
          type="text"
          value={value.breed}
          onChange={(e) => onChange({ ...value, breed: e.target.value })}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Color */}
      <div>
        <label htmlFor="adoption-color" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('strayForm.colorLabel')}
        </label>
        <input
          id="adoption-color"
          type="text"
          value={value.color}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="adoption-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('strayForm.descriptionLabel')}
        </label>
        <textarea
          id="adoption-description"
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          rows={3}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </div>

      {/* City — required. Adoption pets are owner-based (no location report),
          so the city is how adopters filter/find them. */}
      <div>
        <label htmlFor="adoption-city" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {tAdoption('publish.cityLabel')}
        </label>
        <input
          id="adoption-city"
          type="text"
          placeholder={tAdoption('publish.cityPlaceholder')}
          value={value.city}
          onChange={(e) => onChange({ ...value, city: e.target.value })}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {errors.city && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{errors.city}</p>}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
      >
        {tAdoption('publish.submit')}
      </button>
    </div>
  );
}
