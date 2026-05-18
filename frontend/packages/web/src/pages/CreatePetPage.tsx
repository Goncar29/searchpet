import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCreatePet, useUploadPhoto } from '@shared/hooks';
import type { Pet, PetType } from '@shared/types';

interface FormState {
  name: string;
  type: PetType | '';
  breed: string;
  color: string;
  description: string;
}

interface FieldErrors {
  name?: string;
  type?: string;
}

export function CreatePetPage() {
  const { t } = useTranslation(['pets', 'common']);
  const navigate = useNavigate();
  const createPet = useCreatePet();
  const uploadPhoto = useUploadPhoto();

  const [form, setForm] = useState<FormState>({
    name: '',
    type: '',
    breed: '',
    color: '',
    description: '',
  });

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  // Fotos seleccionadas (hasta 3)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewURLs, setPreviewURLs] = useState<string[]>([]);
  // Error no-bloqueante cuando el upload falla DESPUÉS de crear la mascota
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [createdPetId, setCreatedPetId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Limpiar error de campo al editar
    if (name in fieldErrors) {
      setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const MAX_PHOTOS = 3;
  const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = '';

    if (incoming.length === 0) return;

    const slots = MAX_PHOTOS - selectedFiles.length;
    if (slots <= 0) return;

    const candidates = incoming.slice(0, slots);
    const validFiles: File[] = [];
    const newURLs: string[] = [];

    for (const file of candidates) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setUploadError('Formato no permitido. Usá JPG, PNG o WebP.');
        continue;
      }
      if (file.size > MAX_SIZE) {
        setUploadError('Cada foto no puede superar los 5 MB.');
        continue;
      }
      validFiles.push(file);
      newURLs.push(URL.createObjectURL(file));
    }

    if (validFiles.length > 0) {
      setUploadError(null);
      setSelectedFiles((prev) => [...prev, ...validFiles]);
      setPreviewURLs((prev) => [...prev, ...newURLs]);
    }
  };

  const removeFile = (index: number) => {
    setPreviewURLs((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (!form.name.trim()) errors.name = t('common:required');
    if (!form.type) errors.type = t('common:required');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setUploadError(null);

    if (!validate()) return;

    createPet.mutate(
      {
        name: form.name.trim(),
        type: form.type as PetType,
        breed: form.breed.trim() || undefined,
        color: form.color.trim() || undefined,
        description: form.description.trim() || undefined,
      },
      {
        onSuccess: async (pet: Pet) => {
          // Paso 2: subir cada foto seleccionada (no-blocking si falla alguna)
          if (selectedFiles.length > 0) {
            let firstError: string | null = null;
            for (const file of selectedFiles) {
              try {
                await uploadPhoto.mutateAsync({ petId: pet.id, file });
              } catch (err) {
                if (!firstError) {
                  firstError = err instanceof Error ? err.message : 'No se pudo subir una foto';
                }
              }
            }
            if (firstError) {
              // La mascota YA fue creada — no hacemos rollback.
              setUploadError(firstError);
              setCreatedPetId(pet.id);
              return;
            }
          }
          navigate(`/pets/${pet.id}`);
        },
        onError: (err: Error) => {
          setApiError(err.message);
        },
      }
    );
  };

  const isPending = createPet.isPending || uploadPhoto.isPending;
  const atLimit = selectedFiles.length >= MAX_PHOTOS;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-lg mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">
          {t('pets:create.title')}
        </h1>

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Name */}
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('pets:create.name')} *
            </label>
            <input
              id="name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {fieldErrors.name && (
              <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.name}</p>
            )}
          </div>

          {/* Species / Type */}
          <div>
            <label
              htmlFor="type"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('pets:create.species')} *
            </label>
            <select
              id="type"
              name="type"
              value={form.type}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">—</option>
              <option value="perro">{t('pets:types.dog')}</option>
              <option value="gato">{t('pets:types.cat')}</option>
              <option value="otro">{t('pets:types.other')}</option>
            </select>
            {fieldErrors.type && (
              <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.type}</p>
            )}
          </div>

          {/* Breed */}
          <div>
            <label
              htmlFor="breed"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('pets:create.breed')}
            </label>
            <input
              id="breed"
              name="breed"
              type="text"
              value={form.breed}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Color */}
          <div>
            <label
              htmlFor="color"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('pets:create.color')}
            </label>
            <input
              id="color"
              name="color"
              type="text"
              value={form.color}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('pets:create.description')}
            </label>
            <textarea
              id="description"
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {/* Photo upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('pets:create.photo', 'Fotos de la mascota')}
            </label>
            <input
              ref={fileInputRef}
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
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              JPG, PNG o WebP · máx. 5 MB por foto · hasta 3 fotos
            </p>
            {atLimit && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Máximo 3 fotos
              </p>
            )}
            {/* Previews de las imágenes seleccionadas */}
            {previewURLs.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {previewURLs.map((url, i) => (
                  <div key={i} className="relative">
                    <img
                      src={url}
                      alt={`Vista previa ${i + 1}`}
                      className="h-24 w-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
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

          {/* Error de API (pet creation failed) */}
          {apiError && (
            <p className="text-red-500 text-sm">{apiError}</p>
          )}

          {/* Error no-bloqueante de upload (la mascota YA fue creada) */}
          {uploadError && createdPetId && (
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700 p-3 space-y-2">
              <p className="text-yellow-800 dark:text-yellow-300 text-sm font-medium">
                ✓ La mascota fue registrada, pero la foto no pudo subirse.
              </p>
              <p className="text-yellow-700 dark:text-yellow-400 text-sm">
                {uploadError} — Podés agregarla desde el perfil de la mascota.
              </p>
              <button
                type="button"
                onClick={() => navigate(`/pets/${createdPetId}`)}
                className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 underline underline-offset-2 hover:text-yellow-900"
              >
                Ir al perfil de la mascota →
              </button>
            </div>
          )}
          {/* Error de validación client-side de foto (antes de enviar) */}
          {uploadError && !createdPetId && (
            <p className="text-red-500 dark:text-red-400 text-sm">{uploadError}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
          >
            {isPending ? t('common:loading') : t('pets:create.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
