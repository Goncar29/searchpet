import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { FormSection } from '../../components/form/FormSection';
import { FormField } from '../../components/form/FormField';
import { FormActions, formSubmitClass } from '../../components/form/FormActions';

// Los topes son los de las columnas: `local_groups.name` es `size:255` y
// `city` es `size:100` (`domain/models.go`). Sin ellos, una ciudad pegada de
// más de 100 caracteres revienta el INSERT con SQLSTATE 22001, cuyo mensaje NO
// contiene "duplicate key" ni "23505", asi que el repositorio no lo reconoce y
// el handler devuelve 500 `internal` — la forma exacta de la regla #34.
// Esto es la mitad de cliente: `dto.CreateGroupRequest` sigue sin `max`, y ese
// bound es el que de verdad convierte el 500 en un 400.
const MAX_NAME = 255;
const MAX_CITY = 100;

export function GroupsAdminPage() {
  // `errors` explícito y no confiando en que el prefijo resuelva por recursos
  // precargados: `getErrorMessage` arma claves `errors:<code>`, y si no
  // resolvieran el usuario vería la clave cruda — algo que ningún test puede
  // ver, porque ahí `t` está mockeado.
  const { t } = useTranslation(['admin', 'errors']);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.createGroup({
        // Recortados: la unicidad de `city` es un índice de Postgres sobre los
        // BYTES exactos, así que "Montevideo " y "Montevideo" son dos ciudades
        // distintas para la constraint y el guard del 409 se esquiva con un
        // espacio al final.
        name: name.trim(),
        city: city.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: (group) => {
      setSuccessMessage(t('groups.success', { name: group.name, city: group.city }));
      setName('');
      setCity('');
      setDescription('');
      // Vaciar los campos vuelve a deshabilitar el botón, que en ese momento
      // TIENE el foco — y el navegador lo suelta al `<body>`. Un admin que
      // navega con teclado perdía su lugar justo cuando aparece el acuse.
      nameRef.current?.focus();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !city.trim()) return;
    setSuccessMessage('');
    createMutation.mutate();
  };

  return (
    <div>
      {/* El `<h2>` se queda FUERA de la card y no pasa a ser el título de la
          `FormSection`: las ocho pantallas del panel llevan el suyo con este
          mismo marcado, y el `<h1>` lo pone `AdminLayout`. Tampoco hay
          `FormPage` — el frame lo pone el layout, igual que en `AlertsPage`. */}
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('groups.title')}</h2>

      {/* `max-w-2xl` y no el `max-w-md` de antes: con los 32px de padding de
          `FormSection` a cada lado, 448px dejaban los campos en ~384px. */}
      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <FormSection>
            <div className="space-y-6">
              {/* El asterisco lo dibuja `FormField required` — el `<span>*</span>`
                  que había en el JSX se va. Dejar los dos es el doble asterisco
                  que el #185 ya tuvo que reparar una vez. */}
              <FormField label={t('groups.name')} htmlFor="group-name" required>
                {(control) => (
                  <input
                    {...control}
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('groups.namePlaceholder')}
                    maxLength={MAX_NAME}
                    required
                  />
                )}
              </FormField>

              <FormField label={t('groups.city')} htmlFor="group-city" required>
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder={t('groups.cityPlaceholder')}
                    maxLength={MAX_CITY}
                    required
                  />
                )}
              </FormField>

              <FormField
                label={t('groups.description')}
                htmlFor="group-description"
                hint={t('groups.optional')}
              >
                {(control) => (
                  <textarea
                    {...control}
                    className={`${control.className} resize-none`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('groups.descPlaceholder')}
                    rows={3}
                  />
                )}
              </FormField>
            </div>
          </FormSection>

          {/* El fallo dice POR QUÉ falló. `t('groups.error')` era un
              "no se pudo crear, intentá de nuevo" para todo, y el backend
              devuelve 409 `city_group_exists` cuando la ciudad ya tiene grupo
              (`city` lleva `uniqueIndex`): al admin se le pedía reintentar una
              operación que no puede salir bien nunca. La clave ya está
              traducida en los tres idiomas — regla #11. */}
          {createMutation.isError && (
            <p role="alert" className="text-sm text-danger">
              {getErrorMessage(createMutation.error, t)}
            </p>
          )}

          {/* Montado SIEMPRE, con su altura reservada. Una región `polite` que
              se inserta junto con su texto se anuncia de forma poco confiable en
              NVDA/JAWS — a diferencia de `role="alert"`, que el navegador maneja
              al insertarse. Es el patrón que ya usa `PlaceSearch`. */}
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-green-600 dark:text-green-400 font-medium min-h-5"
          >
            {successMessage}
          </p>

          <FormActions
            submit={
              <button
                type="submit"
                disabled={createMutation.isPending || !name.trim() || !city.trim()}
                className={formSubmitClass}
              >
                {createMutation.isPending ? t('groups.creating') : t('groups.submit')}
              </button>
            }
          />
        </form>
      </div>
    </div>
  );
}
