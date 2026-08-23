// ============================================================
// SearchPet - Create Success Story Page (Web)
// ============================================================

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCreateStory } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { FormPage } from '../components/form/FormPage';
import { FormSection } from '../components/form/FormSection';
import { FormField } from '../components/form/FormField';
import { FormActions, formSubmitClass, formCancelClass } from '../components/form/FormActions';

export function CreateStoryPage() {
  const { t } = useTranslation('stories');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const petId = searchParams.get('petId') ?? '';

  const createStory = useCreateStory();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bodyError, setBodyError] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    if (!body.trim()) {
      setBodyError(t('create.bodyRequired'));
      return;
    }
    setBodyError('');

    createStory.mutate(
      {
        pet_id: petId,
        title: title.trim() || undefined,
        body: body.trim(),
      },
      {
        onSuccess: () => {
          navigate(-1);
        },
        onError: (err) => {
          // El mensaje crudo del error se le mostraba al usuario, en inglés y
          // con jerga de API. `getErrorMessage` lo traduce por código (regla #11).
          setApiError(getErrorMessage(err, t));
        },
      },
    );
  };

  return (
    <FormPage icon="celebration" title={t('create.title')} subtitle={t('create.subtitle')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <FormSection title={t('create.storySection')}>
          <div className="space-y-6">
            <FormField
              label={t('create.titleLabel')}
              htmlFor="story-title"
              hint={t('create.optionalHint')}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  /* La columna es varchar(255). Sin este tope el usuario
                     escribe de más, Postgres rechaza el insert y el handler
                     devuelve un 500 genérico: se pierde el borrador sin saber
                     qué campo falló. El backend lo valida también — esto sólo
                     evita que se llegue a intentar. */
                  maxLength={255}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('create.titlePlaceholder')}
                />
              )}
            </FormField>

            <FormField
              label={t('create.bodyLabel')}
              htmlFor="story-body"
              required
              error={bodyError || undefined}
            >
              {(control) => (
                <textarea
                  {...control}
                  className={`${control.className} resize-y`}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    if (e.target.value.trim()) setBodyError('');
                  }}
                  rows={6}
                  placeholder={t('create.bodyPlaceholder')}
                />
              )}
            </FormField>
          </div>
        </FormSection>

        {apiError && (
          <div
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
          >
            {apiError}
          </div>
        )}

        <FormActions
          cancel={
            <button
              type="button"
              onClick={() => navigate(-1)}
              disabled={createStory.isPending}
              className={formCancelClass}
            >
              {t('create.cancel')}
            </button>
          }
          submit={
            <button type="submit" disabled={createStory.isPending} className={formSubmitClass}>
              {createStory.isPending ? t('create.submitting') : t('create.submit')}
            </button>
          }
        />
      </form>
    </FormPage>
  );
}
