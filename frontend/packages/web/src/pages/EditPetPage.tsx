import { useRef, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePetByID, useUpdatePet, useUploadPhoto } from '@shared/hooks';
import type { PetType } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { composeBirthDate, decomposeBirthDate } from '@shared/utils/petBirthDate';
import { PetIdentityFields, type PetIdentityValue } from '../components/PetIdentityFields';
import { cloudinaryFit } from '@shared/utils/cloudinaryThumb';
import { FormPage } from '../components/form/FormPage';
import { FormSection } from '../components/form/FormSection';
import { FormField } from '../components/form/FormField';
import { FormActions, formSubmitClass, formCancelClass } from '../components/form/FormActions';

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
    <FormPage title={t('pets:edit.title')}>
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <FormSection title={t('pets:create.sectionIdentity')}>
            <div className="space-y-6">
              <FormField label={t('pets:create.name')} htmlFor="name" required error={fieldErrors.name}>
                {(control) => (
                  <input {...control} name="name" type="text" value={form.name} onChange={handleChange} />
                )}
              </FormField>

              {/* La especie es de SÓLO LECTURA al editar, asi que no pasa por
                  FormField: no es un control, es un dato mostrado. Del objeto
                  `control` sólo se toma el id, para que el `htmlFor` de la
                  etiqueta apunte a un elemento que existe. */}
              <FormField label={t('pets:create.species')} htmlFor="type">
                {(control) => (
                  <p
                    id={control.id}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-6 py-4 text-sm"
                  >
                    {/* El valor crudo (`perro`, `gato`) es el que guarda la
                        base: sin traducir se leia en minuscula y en español
                        aunque la app estuviera en ingles o portugues. Mismo
                        patron que CreateReportPage.tsx y LostPetStep.tsx. */}
                    {form.type ? t(`pets:types.${form.type}`) : '—'}
                  </p>
                )}
              </FormField>

              <PetIdentityFields
                value={form.identity}
                onChange={(identity) => {
                  setForm((prev) => ({ ...prev, identity }));
                  setFieldErrors((prev) => ({ ...prev, birthDate: undefined }));
                }}
                disabled={isPending}
                birthDateError={fieldErrors.birthDate}
              />

              <div className="grid sm:grid-cols-2 gap-6">
                <FormField label={t('pets:create.breed')} htmlFor="breed">
                  {(control) => (
                    <input {...control} name="breed" type="text" value={form.breed} onChange={handleChange} />
                  )}
                </FormField>

                <FormField label={t('pets:create.color')} htmlFor="color">
                  {(control) => (
                    <input {...control} name="color" type="text" value={form.color} onChange={handleChange} />
                  )}
                </FormField>
              </div>

              <FormField label={t('pets:create.description')} htmlFor="description">
                {(control) => (
                  <textarea
                    {...control}
                    className={`${control.className} resize-y`}
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    rows={3}
                  />
                )}
              </FormField>
            </div>
          </FormSection>

          <FormSection title={t('pets:create.sectionPhotos')}>
            {/* Foto actual */}
            {currentPhoto && !previewURL && (
              <div className="mb-4">
                <img
                  src={cloudinaryFit(currentPhoto.url, 600, 320)}
                  alt={form.name}
                  className="h-40 w-full object-contain rounded-xl border border-gray-200 dark:border-gray-700"
                />
              </div>
            )}

            <FormField label={t('pets:create.photo')} htmlFor="pet-photo" error={uploadError ?? undefined}>
              {(control) => (
                <input
                  {...control}
                  /* Sin la clase de control de texto: la caja del input de
                     archivo la dibuja el navegador. Ver CreatePetPage. */
                  className="block w-full text-sm text-gray-500 dark:text-gray-400
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-semibold
                    file:bg-primary file:text-white
                    hover:file:bg-primary-dark
                    cursor-pointer"
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                />
              )}
            </FormField>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {currentPhoto ? t('pets:edit.replacePhoto') : t('pets:edit.photoHint')}
            </p>

            {previewURL && (
              <div className="mt-4">
                <img
                  src={previewURL}
                  alt={t('pets:edit.previewAlt')}
                  className="h-40 w-full object-contain rounded-xl border border-gray-200 dark:border-gray-700"
                />
              </div>
            )}
          </FormSection>

          {apiError && (
            <p className="text-danger text-sm">{apiError}</p>
          )}

          <FormActions
            cancel={
              <button type="button" onClick={() => navigate('/pets/mine')} className={formCancelClass}>
                {t('common:cancel')}
              </button>
            }
            submit={
              <button type="submit" disabled={isPending} className={formSubmitClass}>
                {isPending ? t('common:loading') : t('pets:edit.submit')}
              </button>
            }
          />
        </form>
    </FormPage>
  );
}
