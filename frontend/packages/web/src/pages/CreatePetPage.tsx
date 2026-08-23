import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCreatePet, useUploadPhoto } from '@shared/hooks';
import type { Pet, PetType } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { composeBirthDate } from '@shared/utils/petBirthDate';
import { PetIdentityFields, type PetIdentityValue } from '../components/PetIdentityFields';
import { Icon } from '../components/Icon';
import { FormPage } from '../components/form/FormPage';
import { FormSection } from '../components/form/FormSection';
import { FormField } from '../components/form/FormField';
import { FormActions, formSubmitClass } from '../components/form/FormActions';

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
    identity: { gender: '', birth: { year: '', month: '', day: '' } },
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
        setUploadError(t('pets:create.photoFormatError'));
        continue;
      }
      if (file.size > MAX_SIZE) {
        setUploadError(t('pets:create.photoSizeError'));
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

    // El par viaja entero o no viaja: composeBirthDate devuelve los dos campos
    // juntos, o undefined. Mandar uno solo es el 400 que el backend rechaza, y
    // acá no hay forma de armarlo — la precisión sale de lo que el usuario
    // llenó, no de un control aparte.
    const birth = composeBirthDate(form.identity.birth);
    // Si eligió un año pero el par no se pudo armar, se avisa en vez de crear
    // la mascota sin fecha y sin decir nada. Acá no se pierde un dato guardado
    // —no hay ninguno todavía— pero el silencio es igual de malo: el usuario
    // cree que cargó la fecha y no está.
    if (form.identity.birth.year && !birth) {
      setFieldErrors((prev) => ({ ...prev, birthDate: t('pets:create.birthDateInvalid') }));
      return;
    }

    createPet.mutate(
      {
        name: form.name.trim(),
        type: form.type as PetType,
        breed: form.breed.trim() || undefined,
        color: form.color.trim() || undefined,
        description: form.description.trim() || undefined,
        gender: form.identity.gender || undefined,
        ...(birth ?? {}),
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
                  firstError = getErrorMessage(err, t);
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
        onError: (err: unknown) => {
          setApiError(getErrorMessage(err, t));
        },
      }
    );
  };

  const isPending = createPet.isPending || uploadPhoto.isPending;
  const atLimit = selectedFiles.length >= MAX_PHOTOS;

  return (
    <FormPage title={t('pets:create.title')}>
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <FormSection title={t('pets:create.sectionIdentity')}>
            <div className="space-y-6">
              <FormField label={t('pets:create.name')} htmlFor="name" required error={fieldErrors.name}>
                {(control) => (
                  <input {...control} name="name" type="text" value={form.name} onChange={handleChange} />
                )}
              </FormField>

              <FormField label={t('pets:create.species')} htmlFor="type" required error={fieldErrors.type}>
                {(control) => (
                  <select {...control} name="type" value={form.type} onChange={handleChange}>
                    <option value="">—</option>
                    <option value="perro">{t('pets:types.dog')}</option>
                    <option value="gato">{t('pets:types.cat')}</option>
                    <option value="otro">{t('pets:types.other')}</option>
                  </select>
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

              {/* Raza y color en una fila: dos campos cortos y opcionales. */}
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

          <FormSection
            title={t('pets:create.sectionPhotos')}
            badge={`${selectedFiles.length}/${MAX_PHOTOS}`}
          >
            <FormField label={t('pets:create.photo')} htmlFor="pet-photo">
              {(control) => (
                <input
                  {...control}
                  /* Sin la clase de control de texto: la caja del input de
                     archivo la dibuja el navegador. Del spread conserva el id y
                     el cableado de aria. */
                  className="block w-full text-sm text-gray-500 dark:text-gray-400
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-semibold
                    file:bg-primary file:text-white
                    hover:file:bg-primary-dark
                    disabled:opacity-40 disabled:cursor-not-allowed
                    cursor-pointer"
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  disabled={atLimit}
                  onChange={handleFileChange}
                />
              )}
            </FormField>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t('pets:create.photoHint')}
            </p>
            {atLimit && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {t('pets:create.photoLimit')}
              </p>
            )}
            {/* Previews de las imágenes seleccionadas */}
            {previewURLs.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {previewURLs.map((url, i) => (
                  <div key={i} className="relative">
                    <img
                      src={url}
                      alt={t('pets:create.photoPreviewAlt', { n: i + 1 })}
                      className="h-24 w-24 object-cover rounded-xl border border-gray-200 dark:border-gray-700"
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white text-xs flex items-center justify-center leading-none hover:opacity-90"
                      aria-label={t('pets:create.removePhoto')}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </FormSection>

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

          <FormActions
            submit={
              <button type="submit" disabled={isPending} className={formSubmitClass}>
                {isPending ? t('common:loading') : t('pets:create.submit')}
              </button>
            }
          />
        </form>
    </FormPage>
  );
}
