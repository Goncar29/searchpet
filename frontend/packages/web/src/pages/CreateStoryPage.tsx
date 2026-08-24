// ============================================================
// SearchPet - Create Success Story Page (Web)
// ============================================================

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCreateStory, useMyPets, useReportedPets } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { FormPage } from '../components/form/FormPage';
import { FormSection } from '../components/form/FormSection';
import { FormField } from '../components/form/FormField';
import { FormActions, formSubmitClass, formCancelClass } from '../components/form/FormActions';

export function CreateStoryPage() {
  const { t } = useTranslation(['stories', 'pets']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetPetId = searchParams.get('petId') ?? '';

  const createStory = useCreateStory();

  // Las DOS listas, no sólo `useMyPets`.
  //
  // El backend autoriza con `canManagePet`, que acepta al DUEÑO de una mascota
  // propia y al REPORTERO de una callejera — y son endpoints distintos:
  // /pets/mine filtra por owner_id y /pets/reported por reporter_id. Con una
  // sola lista, quien encontró una callejera, la reportó y después la marcó
  // como encontrada veria "no tenés mascotas" mientras el backend le habría
  // aceptado la historia. Es el mismo defecto que tuvo LostPetStep, donde el
  // filtro de la pantalla contradecia lo que mostraba otra pantalla del sitio.
  const {
    data: myPets,
    isLoading: loadingMine,
    isError: errorMine,
    refetch: refetchMine,
  } = useMyPets();
  const {
    data: reportedPets,
    isLoading: loadingReported,
    isError: errorReported,
    refetch: refetchReported,
  } = useReportedPets();

  // `isError` de las DOS, y no sólo `data ?? []`.
  //
  // Una query que falló devuelve `data: undefined`, que con `?? []` queda
  // INDISTINGUIBLE de una lista vacía: quien tiene una mascota elegible y se
  // come un 500 lee "todavía no tenés ninguna mascota reencontrada" — una
  // afirmación falsa, sin reintento y sin pista de que hubo un fallo. Es el
  // mismo modo de falla que esta pantalla vino a cerrar, y el repo ya tiene la
  // convención escrita para esto en MyShelterPage.tsx:76 (patrón del PR #82:
  // estados DISTINTOS para "vacío esperado" y "falló el fetch").
  const petsFailed = errorMine || errorReported;

  // Y sólo las `found`: es la tercera regla del service
  // (success_story_service.go:40 responde ErrPetNotFoundStatus). Ofrecer una
  // que no lo esté es dejar que el usuario escriba la historia entera para que
  // el backend la rechace — o sea el mismo bug que este arreglo cierra, movido
  // un paso más adelante.
  const eligiblePets = useMemo(() => {
    const todas = [...(myPets ?? []), ...(reportedPets ?? [])];
    const vistas = new Set<string>();
    return todas.filter((p) => {
      if (p.status !== 'found' || vistas.has(p.id)) return false;
      vistas.add(p.id);
      return true;
    });
  }, [myPets, reportedPets]);

  const loadingPets = loadingMine || loadingReported;
  const [selectedPetId, setSelectedPetId] = useState('');
  const petId = presetPetId || selectedPetId;

  // Con `petId` en la URL hay que comprobarlo IGUAL: una mascota que no está
  // `found` llega hasta el submit y vuelve rechazada. Se busca en las listas ya
  // cargadas en vez de pedirla aparte — si el usuario puede escribir su
  // historia, la mascota está en una de las dos por definición.
  const presetPet = presetPetId ? eligiblePets.find((p) => p.id === presetPetId) : undefined;
  const presetNotEligible = !!presetPetId && !loadingPets && !petsFailed && !presetPet;

  // Por qué no califica, que NO es siempre lo mismo.
  //
  // Si la mascota está en alguna de las dos listas, el motivo es su estado. Si
  // no está en ninguna, no sabemos nada de ella —puede no existir, ser de otro,
  // o estar mal escrito el id— y decir "todavía no está marcada como
  // encontrada" seria afirmar algo que el codigo no puede sostener. Peor con un
  // id ajeno: le estariamos contando al usuario el estado de una mascota que ni
  // siquiera puede ver.
  const presetEnMisListas =
    !!presetPetId &&
    [...(myPets ?? []), ...(reportedPets ?? [])].some((p) => p.id === presetPetId);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [petError, setPetError] = useState('');
  const [bodyError, setBodyError] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    if (!petId) {
      setPetError(t('create.petRequired'));
      return;
    }
    setPetError('');

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

  // Nada de esto puede decidirse mientras las listas cargan: hacerlo mostraria
  // el estado vacio por un instante a alguien que SI tiene mascotas.
  if (loadingPets) {
    return (
      <FormPage icon="celebration" title={t('create.title')}>
        <FormSection>
          <p className="text-center text-gray-500 dark:text-gray-400">{t('create.loading')}</p>
        </FormSection>
      </FormPage>
    );
  }

  // Falló al menos una lista: NO se puede afirmar que el usuario no tenga
  // mascotas, así que se dice lo que sí se sabe y se ofrece reintentar.
  if (petsFailed) {
    return (
      <FormPage icon="celebration" title={t('create.title')}>
        <FormSection>
          <div className="text-center space-y-4">
            <h2 className="font-display text-headline text-gray-900 dark:text-gray-50">
              {t('create.loadErrorTitle')}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">{t('create.loadErrorBody')}</p>
            <button
              type="button"
              onClick={() => {
                // Las dos, porque cualquiera de las dos pudo ser la que falló.
                refetchMine();
                refetchReported();
              }}
              className={`${formSubmitClass} mt-2`}
            >
              {t('create.loadErrorRetry')}
            </button>
          </div>
        </FormSection>
      </FormPage>
    );
  }

  // Sin ninguna mascota elegible el formulario NO se muestra. Antes se podia
  // escribir la historia entera y recien al enviar aparecia un "ocurrio un
  // error inesperado" que ni siquiera decia cual era el problema. Ahora se dice
  // antes, se explica por que, y se ofrece a donde ir.
  if (!presetPetId && eligiblePets.length === 0) {
    return (
      <FormPage icon="celebration" title={t('create.title')}>
        <FormSection>
          <div className="text-center space-y-4">
            <h2 className="font-display text-headline text-gray-900 dark:text-gray-50">
              {t('create.noEligibleTitle')}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">{t('create.noEligibleBody')}</p>
            <Link to="/pets/mine" className={`${formSubmitClass} mt-2`}>
              {t('create.noEligibleCta')}
            </Link>
          </div>
        </FormSection>
      </FormPage>
    );
  }

  // Mismo trato para una mascota pedida por URL que no califica: se corta acá,
  // no despues de que el usuario escriba.
  if (presetNotEligible) {
    return (
      <FormPage icon="celebration" title={t('create.title')}>
        <FormSection>
          <div className="text-center space-y-4">
            <p role="alert" className="text-gray-700 dark:text-gray-300">
              {presetEnMisListas ? t('create.petNotEligible') : t('create.petNotFound')}
            </p>
            <Link to="/pets/mine" className={`${formSubmitClass} mt-2`}>
              {t('create.noEligibleCta')}
            </Link>
          </div>
        </FormSection>
      </FormPage>
    );
  }

  return (
    <FormPage icon="celebration" title={t('create.title')} subtitle={t('create.subtitle')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <FormSection title={t('create.petSection')}>
          {presetPet ? (
            /* Vino por URL desde el detalle de la mascota: no se puede cambiar,
               se muestra cual es. */
            <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 dark:bg-primary/10 px-6 py-4">
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100">{presetPet.name}</p>
                {/* El valor crudo (`perro`, `gato`) es el que guarda la base.
                    Ver CreateReportPage y EditPetPage. */}
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t(`pets:types.${presetPet.type}`)}
                </p>
              </div>
            </div>
          ) : (
            <FormField
              label={t('create.petLabel')}
              htmlFor="story-pet"
              required
              error={petError || undefined}
            >
              {(control) => (
                <select
                  {...control}
                  value={selectedPetId}
                  onChange={(e) => {
                    setSelectedPetId(e.target.value);
                    if (e.target.value) setPetError('');
                  }}
                >
                  <option value="">— {t('create.petPlaceholder')} —</option>
                  {eligiblePets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({t(`pets:types.${p.type}`)})
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
        </FormSection>

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
