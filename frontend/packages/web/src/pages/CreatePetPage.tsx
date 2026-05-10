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
  // Foto seleccionada por el usuario (puede ser null si no eligió ninguna)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState<string | null>(null);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      setPreviewURL(null);
      return;
    }

    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError('Formato no permitido. Usá JPG, PNG o WebP.');
      setSelectedFile(null);
      setPreviewURL(null);
      e.target.value = '';
      return;
    }

    if (file.size > MAX_SIZE) {
      setUploadError('La foto no puede superar los 5 MB.');
      setSelectedFile(null);
      setPreviewURL(null);
      e.target.value = '';
      return;
    }

    setUploadError(null);
    setSelectedFile(file);
    const objectURL = URL.createObjectURL(file);
    setPreviewURL(objectURL);
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
          // Paso 2: si el usuario eligió una foto, subirla con el petId recién creado
          if (selectedFile) {
            try {
              await uploadPhoto.mutateAsync({ petId: pet.id, file: selectedFile });
            } catch (err) {
              // La mascota YA fue creada — no hacemos rollback.
              // El usuario decide cuándo navegar al perfil.
              const message = err instanceof Error ? err.message : 'No se pudo subir la foto';
              setUploadError(message);
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
              {t('pets:create.photo', 'Foto de la mascota')}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 dark:text-gray-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-semibold
                file:bg-primary file:text-white
                hover:file:bg-primary-dark
                cursor-pointer"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              JPG, PNG o WebP · máx. 5 MB
            </p>
            {/* Preview local de la imagen seleccionada */}
            {previewURL && (
              <div className="mt-3">
                <img
                  src={previewURL}
                  alt="Vista previa"
                  className="h-40 w-full object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                />
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
