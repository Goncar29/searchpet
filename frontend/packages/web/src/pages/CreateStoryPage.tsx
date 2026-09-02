// ============================================================
// SearchPet - Create Success Story Page (Web)
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCreateStory, useMyPets, useReportedPets, useUploadStoryPhoto } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { MY_PETS_ROUTE, myPetsRoute } from '../routes';
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
    isPending: pendingMine,
    isFetching: fetchingMine,
    isError: errorMine,
    refetch: refetchMine,
  } = useMyPets();
  const {
    data: reportedPets,
    isPending: pendingReported,
    isFetching: fetchingReported,
    isError: errorReported,
    refetch: refetchReported,
  } = useReportedPets();

  // `isPending` + `isFetching`, NO `isLoading`.
  //
  // En React Query v5 `isLoading` es `isPending && isFetching`, o sea que da
  // FALSE en cuanto hay algo en caché, aunque esté viejo. Y el camino que
  // importa produce exactamente esa situación: marcar una mascota como
  // encontrada llama `invalidateQueries(['pets'])`, que marca la lista como
  // stale pero NO la refetchea (esa query no está montada); el nudge de
  // PetDetailPage navega del lado del cliente, así que la caché sobrevive. Al
  // montar esta pantalla, `useMyPets` devuelve la fila VIEJA con status 'lost'
  // e `isLoading` false — y el usuario lee "todavía no está marcada como
  // encontrada" segundos después de marcarla. Se cura sola cuando aterriza el
  // refetch, pero un arranque en frío de Render son decenas de segundos con un
  // callejón sin salida en pantalla.
  const sinDatos = pendingMine || pendingReported;
  const refrescando = fetchingMine || fetchingReported;

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

  const [selectedPetId, setSelectedPetId] = useState('');
  const petId = presetPetId || selectedPetId;

  // Con `petId` en la URL hay que comprobarlo IGUAL: una mascota que no está
  // `found` llega hasta el submit y vuelve rechazada. Se busca en las listas ya
  // cargadas en vez de pedirla aparte — si el usuario puede escribir su
  // historia, la mascota está en una de las dos por definición.
  const presetPet = presetPetId ? eligiblePets.find((p) => p.id === presetPetId) : undefined;

  // Un fallo sólo bloquea cuando la respuesta DEPENDE de la lista que falló.
  //
  // Si /pets/reported se cae pero /pets/mine trajo la mascota que el usuario
  // venía a contar, negarle la pantalla entera es peor que el problema: ese
  // camino funcionaba antes de este PR. Se bloquea sólo cuando no queda nada
  // que ofrecer; si hay algo, se sigue y se avisa que la lista puede estar
  // incompleta.
  const hayAlgoQueOfrecer = !!presetPet || eligiblePets.length > 0;
  const bloqueaPorFallo = petsFailed && !hayAlgoQueOfrecer;
  const listaIncompleta = petsFailed && hayAlgoQueOfrecer;

  const presetNotEligible = !!presetPetId && !petsFailed && !presetPet;
  const sinElegibles = !presetPetId && eligiblePets.length === 0 && !petsFailed;

  // Los veredictos NEGATIVOS no se emiten con un refetch en vuelo: se estarían
  // apoyando en datos que justo se están reemplazando. El positivo sí puede
  // salir de la caché — mostrar el formulario de más nunca le miente a nadie.
  const vaADecirQueNo = bloqueaPorFallo || sinElegibles || presetNotEligible;

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

  // Si la mascota que no califica es una CALLEJERA que el usuario reportó, la
  // pestaña correcta es esa: "Mis mascotas" abre en `owned`, que para alguien
  // cuyo único vínculo son callejeras reportadas está vacía — mandarlo ahí es
  // mandarlo a otra pantalla que le dice que no tiene nada.
  const presetEsReportada = !!presetPetId && (reportedPets ?? []).some((p) => p.id === presetPetId);
  const destinoDelCta = presetEsReportada ? myPetsRoute('reported') : MY_PETS_ROUTE;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [petError, setPetError] = useState('');
  const [bodyError, setBodyError] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);

  // La foto es OPCIONAL y se sube recién al enviar, no al elegirla.
  //
  // El preview sale de `URL.createObjectURL`, que es local y gratis. Subir al
  // elegir daría el mismo preview pero gastaría cuota de Cloudinary por cada
  // usuario que abandona el formulario — y el plan gratuito son 25 créditos al
  // mes para todo el proyecto (regla #1: $0/mes sin excepciones).
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const uploadPhoto = useUploadStoryPhoto();

  // El objectURL se revoca cuando deja de usarse: cada `createObjectURL` retiene
  // el archivo en memoria hasta que se lo suelta explícitamente. Elegir cinco
  // fotos seguidas sin esto deja cuatro colgadas.
  useEffect(() => {
    if (!photoPreview) return;
    return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp'];

  // Se valida acá ADEMÁS de en el backend, y no en lugar de. El backend es la
  // autoridad —detecta el MIME leyendo los bytes, no del header que manda el
  // cliente— pero enterarse del rechazo recién al enviar significa perder el
  // borrador entero por un archivo equivocado.
  const elegirFoto = (file: File | null) => {
    setPhotoError('');
    setApiError(null);
    if (!file) {
      setPhotoFile(null);
      setPhotoPreview(null);
      return;
    }
    if (!TIPOS_ACEPTADOS.includes(file.type)) {
      setPhotoError(t('create.photoWrongType'));
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(t('create.photoTooLarge'));
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

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

    const publicar = (photoAfter?: string) =>
      createStory.mutate(
        {
          pet_id: petId,
          title: title.trim() || undefined,
          body: body.trim(),
          photo_after: photoAfter,
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

    if (!photoFile) {
      publicar();
      return;
    }

    // Si la foto falla, la historia NO se publica.
    //
    // La alternativa —publicar sin foto y seguir— es peor: el usuario eligió una
    // foto, ve que la historia se creó, y nunca se entera de que quedó sin ella.
    // Abortar con un mensaje que ofrece las dos salidas (reintentar o quitar la
    // foto) es lo único que no le miente.
    uploadPhoto.mutate(
      { petId, file: photoFile },
      {
        onSuccess: ({ url }) => publicar(url),
        onError: () => setApiError(t('create.photoUploadFailed')),
      },
    );
  };

  // Nada de esto puede decidirse mientras las listas cargan: hacerlo mostraria
  // el estado vacio por un instante a alguien que SI tiene mascotas.
  if (sinDatos || (vaADecirQueNo && refrescando)) {
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
  if (bloqueaPorFallo) {
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
  if (sinElegibles) {
    return (
      <FormPage icon="celebration" title={t('create.title')}>
        <FormSection>
          <div className="text-center space-y-4">
            <h2 className="font-display text-headline text-gray-900 dark:text-gray-50">
              {t('create.noEligibleTitle')}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">{t('create.noEligibleBody')}</p>
            {/* La ruta sale de la CONSTANTE, no de un string tipeado a mano.
                `routes.ts` existe por un defecto concreto: un link a `/my-pets`
                —que no es una ruta de esta app— dejaba la página EN BLANCO,
                porque no hay `path="*"`. Con la constante, un rename rompe el
                test en vez de producir otra pantalla vacía. */}
            <Link to={MY_PETS_ROUTE} className={`${formSubmitClass} mt-2`}>
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
            <Link to={destinoDelCta} className={`${formSubmitClass} mt-2`}>
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
          {/* Se sigue, pero se avisa: una de las dos listas no cargó, así que
              lo que se ofrece puede estar incompleto. Bloquear la pantalla
              entera cuando ya hay algo que ofrecer es peor que el problema. */}
          {listaIncompleta && (
            <p
              role="status"
              className="mb-4 rounded-xl border border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-200"
            >
              {t('create.partialListWarning')}
            </p>
          )}
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

            {/* La foto es opcional y lo dice el `hint`, igual que el título.
                El `<input type="file">` NO recibe `{...control}` completo: su
                `className` es el del sistema de formularios, pensado para un
                campo de texto, y sobre un file input deja un control alto y
                vacío. Se toma sólo el `id`, que es lo que lo ata a su label. */}
            <FormField
              label={t('create.photoLabel')}
              htmlFor="story-photo"
              hint={t('create.optionalHint')}
              description={t('create.photoHelp')}
              error={photoError || undefined}
            >
              {(control) => (
                <div className="space-y-3">
                  <input
                    id={control.id}
                    aria-describedby={control['aria-describedby']}
                    aria-invalid={control['aria-invalid']}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-gray-600 dark:text-gray-300 file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-primary-dark"
                  />

                  {photoPreview && (
                    <div className="space-y-2">
                      <img
                        src={photoPreview}
                        alt={t('create.photoAlt')}
                        className="max-h-56 w-full rounded-xl object-contain bg-gray-50 dark:bg-gray-800"
                      />
                      <button
                        type="button"
                        onClick={() => elegirFoto(null)}
                        className="text-sm font-semibold text-danger hover:underline"
                      >
                        {t('create.photoRemove')}
                      </button>
                    </div>
                  )}
                </div>
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
