import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import { FormSection } from '../../components/form/FormSection';
import { FormField } from '../../components/form/FormField';
import { FormActions, formSubmitClass } from '../../components/form/FormActions';

export function GroupsAdminPage() {
  const { t } = useTranslation('admin');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.createGroup({
        name,
        city,
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: (group) => {
      setSuccessMessage(t('groups.success', { name: group.name, city: group.city }));
      setName('');
      setCity('');
      setDescription('');
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
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('groups.namePlaceholder')}
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

          {/* Los dos avisos se ANUNCIAN. Antes eran `<p>` mudos: quien no mira la
              pantalla enviaba el formulario y no recibía nada, ni el fallo ni la
              confirmación. `role="alert"` interrumpe, `role="status"` espera —
              que es la diferencia entre un error y un acuse. */}
          {createMutation.isError && (
            <p role="alert" className="text-sm text-danger">
              {t('groups.error')}
            </p>
          )}

          {successMessage && (
            <p role="status" className="text-sm text-green-600 dark:text-green-400 font-medium">
              {successMessage}
            </p>
          )}

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
