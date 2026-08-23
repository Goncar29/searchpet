import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { IntentStep } from '../components/publish/IntentStep';
import { LostPetStep } from '../components/publish/LostPetStep';
import { StrayFormStep } from '../components/publish/StrayFormStep';
import { AdoptionFormStep } from '../components/publish/AdoptionFormStep';
import { LocationStep } from '../components/publish/LocationStep';
import { SuccessStep } from '../components/publish/SuccessStep';
import { InlineAuthStep } from '../components/publish/InlineAuthStep';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { useCreatePet, usePublishStray, useUploadPhoto } from '@shared/hooks';
import { composeBirthDate } from '@shared/utils/petBirthDate';
import type { PetIdentityValue } from '../components/PetIdentityFields';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { Pet, CreatePetRequest, InitialReportRequest } from '@shared/types';

export type PublishStep = 'intent' | 'lost-pet' | 'stray-form' | 'adoption-form' | 'location' | 'auth' | 'success';
export type PublishIntent = 'lost' | 'stray' | 'adoption';

// Los pasos validos, para filtrar lo que venga por la URL.
const PUBLISH_STEPS: PublishStep[] = ['intent', 'lost-pet', 'stray-form', 'adoption-form', 'location', 'auth', 'success'];

// Tres pasos llevan el intent implícito en su propio nombre, y a `location`
// sólo se llega desde el de callejera. Con esto, un paso pedido por URL puede
// reconstruir el intent que se perdió al recargar.
const STEP_INTENT: Partial<Record<PublishStep, PublishIntent>> = {
  'lost-pet': 'lost',
  'stray-form': 'stray',
  'adoption-form': 'adoption',
  location: 'stray',
};

export interface StrayFormState {
  type: CreatePetRequest['type'] | '';
  breed: string;
  color: string;
  // Sólo el sexo, sin fecha: quien reporta una callejera la encontró en la
  // calle. El sexo lo puede ver; cuándo nació, no. Ver hideBirthDate.
  identity: PetIdentityValue;
  description: string;
  photos: File[];
  // Opt-in: expose the reporter's WhatsApp publicly so logged-out finders can reach them.
  contactPublic: boolean;
}

export interface AdoptionFormState {
  type: CreatePetRequest['type'] | '';
  breed: string;
  color: string;
  identity: PetIdentityValue;
  description: string;
  city: string;
  photos: File[];
}

export interface PublishWizardState {
  intent: PublishIntent | null;
  strayForm: StrayFormState;
  adoptionForm: AdoptionFormState;
  location: InitialReportRequest | null;
}

export const initialWizardState: PublishWizardState = {
  intent: null,
  strayForm: { type: '', breed: '', color: '', description: '', photos: [], contactPublic: false, identity: { gender: '', birth: { year: '', month: '', day: '' } } },
  adoptionForm: { type: '', breed: '', color: '', description: '', city: '', photos: [], identity: { gender: '', birth: { year: '', month: '', day: '' } } },
  location: null,
};

export function PublishWizardPage() {
  const { t } = useTranslation('publish');
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [wizard, setWizard] = useState<PublishWizardState>(initialWizardState);
  const [publishedPet, setPublishedPet] = useState<Pet | null>(null);

  // El paso vive en la URL, no en useState. Tres motivos, en orden de peso:
  //
  // 1. El link "Publicar" del navbar apunta a /publish. Con el paso en estado
  //    local, un usuario metido en un formulario que lo tocaba SEGUÍA VIENDO EL
  //    FORMULARIO: React Router no navega cuando el destino es idéntico al
  //    actual, así que no remontaba nada (regla #51). Ahora el destino es
  //    /publish sin query y el actual es /publish?paso=…, o sea que SÍ son
  //    distintos: navega, el paso vuelve a 'intent' y el wizard se resetea.
  // 2. El botón atrás del navegador recorre los pasos en vez de salirse de la
  //    página entera.
  // 3. Un F5 en el medio no te devuelve al principio.
  //
  // El BORRADOR sigue en memoria a propósito: se pierde con el refresh, pero
  // meterlo en la URL implicaría poner fotos y notas en la barra de direcciones.
  const [searchParams, setSearchParams] = useSearchParams();
  const setStep = (s: PublishStep) => {
    // `intent` no lleva query: deja la URL limpia y hace que el link del navbar
    // apunte exactamente al estado inicial.
    //
    // `success` REEMPLAZA la entrada anterior en vez de apilarse. Apilar los
    // pasos hizo del botón atrás del navegador una superficie nueva: un back
    // desde la pantalla de éxito aterrizaba en el formulario recién publicado,
    // con el borrador entero todavía en memoria y su botón "Publicar" vivo, y
    // tocarlo creaba una SEGUNDA mascota. El guard de abajo lo corta igual —
    // esto además evita dejar la URL apuntando a un paso que ya no se ve.
    setSearchParams(s === 'intent' ? {} : { paso: s }, { replace: s === 'success' });
  };

  // Un paso pedido por URL puede ser inalcanzable: `success` sin mascota
  // publicada renderizaría una pantalla en blanco, y `location` sin borrador
  // dejaría publicar una callejera sin foto ni tipo. En esos casos se cae a
  // 'intent' en vez de mostrar algo roto — la URL es entrada de usuario y hay
  // que tratarla como tal.
  const pasoPedido = searchParams.get('paso') as PublishStep | null;
  const step: PublishStep = ((): PublishStep => {
    if (!pasoPedido || !PUBLISH_STEPS.includes(pasoPedido)) return 'intent';
    // Ya hay una mascota publicada: ningún paso previo puede volver a
    // renderizarse, porque su botón "Publicar" sigue funcionando y el borrador
    // sigue completo. Va PRIMERO justamente por eso — los guards de abajo miran
    // el borrador, que en este punto pasa todos.
    if (publishedPet) return 'success';
    // De acá para abajo, publishedPet es null.
    if (pasoPedido === 'success') return 'intent';
    if (pasoPedido === 'location' && !wizard.strayForm.type) return 'intent';
    if (pasoPedido === 'auth' && !wizard.intent) return 'intent';
    return pasoPedido;
  })();

  const handleIntentSelect = (intent: PublishIntent) => {
    setWizard((prev) => ({ ...prev, intent }));
    if (intent === 'lost' && !isAuthenticated) {
      setStep('auth');
      return;
    }
    if (intent === 'lost') {
      setStep('lost-pet');
      return;
    }
    if (intent === 'adoption') {
      setStep('adoption-form');
      return;
    }
    setStep('stray-form');
  };

  // Al paso de ubicación sólo se llega desde el formulario de callejera: el
  // camino de "mi mascota se perdió" ahora deriva al formulario de reporte.
  const handleBackFromLocation = () => {
    setStep('stray-form');
  };

  // Elegir una de las tres opciones era un camino de ida: ninguno de esos pasos
  // recibía un `onBack`, así que la única salida era navegar a otra parte del
  // sitio. El link "Publicar" del navbar tampoco servía — apunta a /publish y
  // el usuario ya está en /publish, así que React Router no cambia de ruta, no
  // remonta la página y este `step` sobrevive.
  //
  // Vuelve al inicio limpio: el borrador pertenece a la opción que se está
  // abandonando, y arrastrarlo a otra sería peor que perderlo. El reset ya no
  // se hace acá — lo hace el efecto que vigila el paso `intent`, así TODOS los
  // caminos que llegan al selector quedan limpios y no sólo los que se
  // acuerdan de limpiar.
  const backToIntent = () => {
    setStep('intent');
  };

  // El paso `auth` también era un callejón sin salida, y es el peor de todos:
  // a un usuario sin sesión que elige "mi mascota se perdió" lo primero que le
  // aparece es el login, sin ninguna forma de volver a las opciones.
  //
  // No alcanza con sumar 'auth' a la lista de arriba: se llega por TRES
  // caminos y dos de ellos traen un formulario ya completado. Como
  // `backToIntent` resetea el borrador, mandarlos al selector les borraría lo
  // que acaban de cargar — perder el trabajo sería peor que el callejón que
  // esto viene a cerrar. Así que cada camino vuelve al paso del que vino.
  const resolveBack = (): { onBack: () => void; label: string } | null => {
    if (step === 'lost-pet' || step === 'stray-form' || step === 'adoption-form') {
      return { onBack: backToIntent, label: t('back') };
    }
    if (step !== 'auth') return null;
    // Desde el selector: no hay nada cargado que perder.
    if (wizard.intent === 'lost') return { onBack: backToIntent, label: t('back') };
    // Desde un formulario ya completado: vuelve al formulario, no al selector.
    // Limpia el error igual que backToIntent: si un intento anterior falló, el
    // cartel rojo sobrevive al cambio de paso y queda arriba de un formulario
    // que no tiene nada de malo.
    const backTo = (target: PublishStep) => () => {
      setPublishError(null);
      setStep(target);
    };
    if (wizard.intent === 'adoption') return { onBack: backTo('adoption-form'), label: t('backStep') };
    return { onBack: backTo('location'), label: t('backStep') };
  };

  // publishedPet se declara arriba, junto al wizard: la validación del paso
  // pedido por URL lo necesita para no dejar entrar a `success` en blanco.
  const [failedPhotoIndexes, setFailedPhotoIndexes] = useState<number[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);

  // El paso pasó a vivir en la URL, pero el intent siguió viviendo SÓLO en
  // memoria — y esa mezcla era el agujero. Un F5 en /publish?paso=stray-form
  // (justo el escenario que la URL venía a habilitar) dejaba `intent` en null.
  // Nada lo notaba, porque el formulario se ve idéntico: el usuario lo
  // completaba, publicaba, LA MASCOTA SE CREABA DE VERDAD, y el guard de render
  // de `success` —que exige `intent`— dejaba la pantalla EN BLANCO. El mismo
  // null mandaba al usuario sin sesión derecho a un 401 en vez de al login, y
  // rebotaba el camino de adopción al selector sin explicar nada.
  //
  // Se repara en un solo lugar y no en cada handler porque los consumidores del
  // intent son seis (handlePublish, handleAdoptionSubmit, resolveBack, el
  // callback de InlineAuthStep, handleRetryPhotos y el render de `success`), y
  // alcanza con que uno se olvide para que vuelva el mismo bug.
  useEffect(() => {
    const implicito = STEP_INTENT[step];
    if (!implicito) return;
    setWizard((prev) => (prev.intent ? prev : { ...prev, intent: implicito }));
  }, [step]);

  // `intent` es por definición el estado inicial, y hacerlo cumplir acá es lo
  // que vuelve honesto al link "Publicar" del navbar. Ese link sólo cambia la
  // URL: la ruta es la misma, el componente NO remonta, así que el borrador
  // sobrevivía intacto en useState. Publicar → navbar "Publicar" → "encontré
  // una callejera" mostraba el formulario PRELLENADO con las fotos y el tipo de
  // la mascota recién publicada, y volver a tocar "Publicar" creaba un
  // duplicado. Los setters usan la forma funcional para no re-renderizar de
  // más cuando ya está todo limpio, que es el caso del primer montaje.
  useEffect(() => {
    if (step !== 'intent') return;
    setWizard((prev) => (prev === initialWizardState ? prev : initialWizardState));
    setPublishedPet(null);
    setFailedPhotoIndexes((prev) => (prev.length === 0 ? prev : []));
    setPublishError(null);
  }, [step]);

  const publishStray = usePublishStray();
  const createPet = useCreatePet();
  const uploadPhoto = useUploadPhoto();

  const buildAdoptionPayload = (): CreatePetRequest => ({
    name: t('strayForm.unnamedPet'),
    type: wizard.adoptionForm.type as CreatePetRequest['type'],
    breed: wizard.adoptionForm.breed.trim() || undefined,
    color: wizard.adoptionForm.color.trim() || undefined,
    description: wizard.adoptionForm.description.trim() || undefined,
    city: wizard.adoptionForm.city.trim(),
    gender: wizard.adoptionForm.identity.gender || undefined,
    // El par viaja entero o no viaja; composeBirthDate devuelve los dos juntos
    // o undefined. Mandar uno solo es el 400 que el backend rechaza.
    ...(composeBirthDate(wizard.adoptionForm.identity.birth) ?? {}),
    status: 'adoption',
  });

  // Mirrors submitStray's chain: createPet then sequential (non-blocking) photo
  // uploads via the same useUploadPhoto hook, collecting failedPhotoIndexes for
  // the success step's one-tap retry. No location/report step for adoption.
  const submitAdoption = async () => {
    try {
      const created = await createPet.mutateAsync(buildAdoptionPayload());
      const failed: number[] = [];
      for (let i = 0; i < wizard.adoptionForm.photos.length; i++) {
        try {
          await uploadPhoto.mutateAsync({ petId: created.id, file: wizard.adoptionForm.photos[i] });
        } catch {
          failed.push(i);
        }
      }
      setPublishedPet(created);
      setFailedPhotoIndexes(failed);
      setStep('success');
      try {
        const freshPet = await apiClient.getPetByID(created.id);
        setPublishedPet(freshPet);
      } catch {
        // Keep `created` — already set above.
      }
    } catch (err) {
      setPublishError(getErrorMessage(err, t));
    }
  };

  const handleAdoptionSubmit = async () => {
    setPublishError(null);
    if (!isAuthenticated) {
      setStep('auth');
      return;
    }
    await submitAdoption();
  };

  const buildStrayPayload = (location: NonNullable<typeof wizard.location>): CreatePetRequest => ({
    name: t('strayForm.unnamedPet'),
    type: wizard.strayForm.type as CreatePetRequest['type'],
    breed: wizard.strayForm.breed.trim() || undefined,
    color: wizard.strayForm.color.trim() || undefined,
    description: wizard.strayForm.description.trim() || undefined,
    gender: wizard.strayForm.identity.gender || undefined,
    // Se manda el par aunque HOY el formulario de callejera no lo pida
    // (hideBirthDate), asi que `birth` viene vacio y composeBirthDate devuelve
    // undefined. No es codigo muerto: es que quien maniana saque ese prop
    // obtenga un date picker que FUNCIONA. Leyendo solo `gender`, tendria tres
    // selects andando cuyo valor nunca llega a la API — sin error de tipos, sin
    // test rojo y sin sintoma.
    ...(composeBirthDate(wizard.strayForm.identity.birth) ?? {}),
    status: 'stray',
    initial_report: location,
    reporter_contact_public: wizard.strayForm.contactPublic,
  });

  const submitStray = async (location: NonNullable<typeof wizard.location>) => {
    try {
      const result = await publishStray.mutateAsync({ pet: buildStrayPayload(location), photos: wizard.strayForm.photos });
      // Set the stale pet first so the success step renders immediately —
      // the render guard requires publishedPet, and the refetch below is async.
      setPublishedPet(result.pet);
      setFailedPhotoIndexes(result.failedPhotoIndexes);
      setStep('success');
      // Photo uploads happen after pet creation inside the mutation, so
      // `result.pet` has stale `photos: []`. Refetch so SuccessStep/SharePanel
      // get the uploaded photos. A refetch failure never blocks the success
      // step — the publish itself already succeeded.
      try {
        const freshPet = await apiClient.getPetByID(result.pet.id);
        setPublishedPet(freshPet);
      } catch {
        // Keep result.pet — already set above.
      }
    } catch (err) {
      setPublishError(getErrorMessage(err, t));
    }
  };

  const handlePublish = async (location: typeof wizard.location) => {
    if (!location) return;
    setWizard((prev) => ({ ...prev, location }));
    setPublishError(null);

    if (!isAuthenticated && wizard.intent === 'stray') {
      setStep('auth');
      return;
    }

    await submitStray(location);
  };

  // El reset lo hace el efecto del paso `intent`, igual que backToIntent.
  const handlePublishAnother = () => {
    setStep('intent');
  };

  const handleRetryPhotos = async () => {
    if (!publishedPet) return;
    const sourcePhotos = wizard.intent === 'adoption' ? wizard.adoptionForm.photos : wizard.strayForm.photos;
    const stillFailed: number[] = [];
    let retriedAny = false;
    for (const index of failedPhotoIndexes) {
      const file = sourcePhotos[index];
      if (!file) continue;
      try {
        await uploadPhoto.mutateAsync({ petId: publishedPet.id, file });
        retriedAny = true;
      } catch {
        stillFailed.push(index);
      }
    }
    setFailedPhotoIndexes(stillFailed);

    if (retriedAny) {
      try {
        const freshPet = await apiClient.getPetByID(publishedPet.id);
        setPublishedPet(freshPet);
      } catch {
        // Keep the existing publishedPet — retry already succeeded.
      }
    }
  };

  const back = resolveBack();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {publishError && (
          <p className="text-red-500 dark:text-red-400 text-sm text-center mb-4">{publishError}</p>
        )}
        {/* Vive acá y no adentro de cada paso a propósito: volver al selector es
            una decisión del wizard, no del formulario. Puesto acá cubre además
            el estado vacío de LostPetStep, que es justo donde el usuario
            quedaba trabado sin ninguna salida. */}
        {back && (
          <button
            type="button"
            onClick={back.onBack}
            className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-primary dark:text-gray-400 transition-colors"
          >
            <Icon name="arrow-back" />
            {back.label}
          </button>
        )}
        {step === 'intent' && <IntentStep onSelect={handleIntentSelect} />}
        {step === 'lost-pet' && (
          // Elegir la mascota deriva al formulario de reporte que ya existe en
          // vez de al paso de ubicación del wizard. Los dos terminan igual:
          // POST /api/reports con status "lost" abre el episodio y transiciona
          // la mascota a `lost` dentro de la misma transacción, exactamente lo
          // que hacía publish-lost. La diferencia es que el formulario de
          // reporte además pide la FECHA (`occurred_at`), que el paso de
          // ubicación no tiene — y con una mascota perdida el cuándo importa
          // tanto como el dónde. Un solo formulario de reporte, no dos.
          <LostPetStep
            onSelect={(pet) => navigate(`/reports/create?petId=${pet.id}&status=lost`)}
          />
        )}
        {step === 'stray-form' && (
          <StrayFormStep
            value={wizard.strayForm}
            onChange={(strayForm) => setWizard((prev) => ({ ...prev, strayForm }))}
            onNext={() => setStep('location')}
          />
        )}
        {step === 'adoption-form' && (
          <AdoptionFormStep
            value={wizard.adoptionForm}
            onChange={(adoptionForm) => setWizard((prev) => ({ ...prev, adoptionForm }))}
            onSubmit={handleAdoptionSubmit}
            isPending={createPet.isPending || uploadPhoto.isPending}
          />
        )}
        {step === 'location' && (
          <LocationStep
            value={wizard.location}
            onPublish={handlePublish}
            onBack={handleBackFromLocation}
            isPending={publishStray.isPending}
          />
        )}
        {step === 'auth' && (
          <InlineAuthStep
            onAuthenticated={() => {
              if (wizard.intent === 'lost') {
                setStep('lost-pet');
                return;
              }
              if (wizard.intent === 'adoption') {
                submitAdoption();
                return;
              }
              if (wizard.location) submitStray(wizard.location);
            }}
          />
        )}
        {step === 'success' && publishedPet && wizard.intent && (
          <SuccessStep
            pet={publishedPet}
            intent={wizard.intent}
            failedPhotoCount={failedPhotoIndexes.length}
            onRetryPhotos={handleRetryPhotos}
            isRetrying={uploadPhoto.isPending}
            onPublishAnother={handlePublishAnother}
          />
        )}
      </div>
    </div>
  );
}
