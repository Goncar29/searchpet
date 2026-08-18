import { useRef, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePetByID, useUpdatePet, useUploadPhoto } from '@shared/hooks';
import type { PetType } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { composeBirthDate, decomposeBirthDate } from '@shared/utils/petBirthDate';
import { PetIdentityFields, type PetIdentityValue } from '../components/PetIdentityFields';
import { cloudinaryFit } from '@shared/utils/cloudinaryThumb';

interface FormState {
  name: string;
  type: PetType | '';
  breed: string;
  color: string;
  description: string;
  identity: PetIdentityValue;
}

interface FieldErrors {
  name?: string;
  type?: string;
  birthDate?: string;
}

export function EditPetPage() {
  const { t } = useTranslation(['pets', 'common']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updatePet = useUpdatePet();
  const uploadPhoto = useUploadPhoto();

  const { data: pet, isLoading } = usePetByID(id ?? '');

  const [form, setForm] = useState<FormState>({
    name: '',
    type: '',
    breed: '',
    color: '',
    description: '',
    identity: { gender: '', birth: { year: '', month: '', day: '' } },
  });

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill form when pet data loads
  useEffect(() => {
    if (pet) {
      setForm({
        name: pet.name,
        type: pet.type,
        breed: pet.breed ?? '',
        color: pet.color ?? '',
        description: pet.description ?? '',
        identity: {
          gender: pet.gender ?? '',
          // decomposeBirthDate devuelve SÓLO los componentes que la precisión
          // declara reales. Con precisión 'year' el backend guarda
          // "2022-01-01", y rehidratar mes=enero y día=1 mostraría una fecha
          // exacta que el dueño nunca afirmó — y al guardar sin tocar nada la
          // precisión subiría a 'day'. El dato se contaminaría solo, con abrir
          // y cerrar esta pantalla.
          birth: decomposeBirthDate(pet.birth_date, pet.birth_date_precision),
        },
      });
    }
  }, [pet]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
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

    const MAX_SIZE = 5 * 1024 * 1024;
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError('Formato no permitido. Usá JPG, PNG o WebP.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_SIZE) {
      setUploadError('La foto no puede superar los 5 MB.');
      e.target.value = '';
      return;
    }

    setUploadError(null);
    setSelectedFile(file);
    setPreviewURL(URL.createObjectURL(file));
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
    if (!id || !validate()) return;

    setApiError(null);
    setUploadError(null);

    const birth = composeBirthDate(form.identity.birth);
    // Segunda mitad del arreglo: acotar la oferta impide ELEGIR una fecha
    // futura, pero no cubre una que ya esté guardada. El backend tolera un día
    // de gracia sobre UTC, así que una mascota con la fecha de mañana entra por
    // la API y después este formulario la rechaza. Sin este corte, el `?? ''`
    // de abajo la interpretaría como "borrá el par" y la fecha desaparecería en
    // silencio, con navegación a /pets/mine incluida.
    if (form.identity.birth.year && !birth) {
      setFieldErrors((prev) => ({ ...prev, birthDate: t('pets:create.birthDateInvalid') }));
      return;
    }

    updatePet.mutate(
      {
        id,
        data: {
          name: form.name.trim(),
          // Send the trimmed value (even ""), not undefined: the backend uses a
          // pointer to tell "omitted" from "cleared", so "" empties the field —
          // letting the user actually clear an optional field when editing.
          breed: form.breed.trim(),
          color: form.color.trim(),
          description: form.description.trim(),
          gender: form.identity.gender,
          // Mismo criterio que los demás opcionales: se manda el valor SIEMPRE,
          // incluso vacío, para que se pueda borrar. Si el usuario dejó el año
          // en blanco, van los dos en '' y el backend limpia el par completo —
          // nunca uno solo, que sería el request contradictorio que da 400.
          birth_date: birth?.birth_date ?? '',
          birth_date_precision: birth?.birth_date_precision ?? '',
        },
      },
      {
        onSuccess: async () => {
          if (selectedFile) {
            try {
              await uploadPhoto.mutateAsync({ petId: id, file: selectedFile });
            } catch (err) {
              setUploadError(getErrorMessage(err, t));
              return;
            }
          }
          navigate('/pets/mine');
        },
        onError: (err) => {
          setApiError(getErrorMessage(err, t));
        },
      }
    );
  };

  const isPending = updatePet.isPending || uploadPhoto.isPending;
  const currentPhoto = pet?.photos?.find((p) => p.is_primary) ?? pet?.photos?.[0];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
        <div className="max-w-lg mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-md p-8 animate-pulse space-y-4">
          <div className="h-8 w-1/3 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-lg" />
          <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-lg" />
          <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-lg mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">
          {t('pets:edit.title')}
        </h1>

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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

          {/* Species / Type — solo lectura en edición */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('pets:create.species')}
            </label>
            <p className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-3 py-2 text-sm">
              {form.type || '—'}
            </p>
          </div>

          <PetIdentityFields
            value={form.identity}
            onChange={(identity) => {
              setForm((prev) => ({ ...prev, identity }));
              setFieldErrors((prev) => ({ ...prev, birthDate: undefined }));
            }}
            disabled={isPending}
            birthDateError={fieldErrors.birthDate}
          />

          {/* Breed */}
          <div>
            <label htmlFor="breed" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
            <label htmlFor="color" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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

          {/* Photo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('pets:create.photo', 'Foto de la mascota')}
            </label>

            {/* Foto actual */}
            {currentPhoto && !previewURL && (
              <div className="mb-3">
                <img
                  src={cloudinaryFit(currentPhoto.url, 600, 320)}
                  alt={form.name}
                  className="h-40 w-full object-contain rounded-lg border border-gray-200 dark:border-gray-700"
                />
              </div>
            )}

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
              {currentPhoto ? t('pets:edit.replacePhoto', 'Subí una nueva para reemplazar la actual') : 'JPG, PNG o WebP · máx. 5 MB'}
            </p>

            {previewURL && (
              <div className="mt-3">
                <img
                  src={previewURL}
                  alt="Vista previa"
                  className="h-40 w-full object-contain rounded-lg border border-gray-200 dark:border-gray-700"
                />
              </div>
            )}

            {uploadError && (
              <p className="text-red-500 dark:text-red-400 text-sm mt-1">{uploadError}</p>
            )}
          </div>

          {apiError && (
            <p className="text-red-500 text-sm">{apiError}</p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/pets/mine')}
              className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
            >
              {isPending ? t('common:loading') : t('pets:edit.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
