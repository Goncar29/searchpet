import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { IntentStep } from '../components/publish/IntentStep';
import { LostPetStep } from '../components/publish/LostPetStep';
import { StrayFormStep } from '../components/publish/StrayFormStep';
import { AdoptionFormStep } from '../components/publish/AdoptionFormStep';
import { LocationStep } from '../components/publish/LocationStep';
import { SuccessStep } from '../components/publish/SuccessStep';
import { InlineAuthStep } from '../components/publish/InlineAuthStep';
import { useAuth } from '../context/AuthContext';
import { useCreatePet, usePublishStray, useUploadPhoto } from '@shared/hooks';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { Pet, CreatePetRequest, InitialReportRequest } from '@shared/types';

export type PublishStep = 'intent' | 'lost-pet' | 'stray-form' | 'adoption-form' | 'location' | 'auth' | 'success';
export type PublishIntent = 'lost' | 'stray' | 'adoption';

export interface StrayFormState {
  type: CreatePetRequest['type'] | '';
  breed: string;
  color: string;
  description: string;
  photos: File[];
  // Opt-in: expose the reporter's WhatsApp publicly so logged-out finders can reach them.
  contactPublic: boolean;
}

export interface AdoptionFormState {
  type: CreatePetRequest['type'] | '';
  breed: string;
  color: string;
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
  strayForm: { type: '', breed: '', color: '', description: '', photos: [], contactPublic: false },
  adoptionForm: { type: '', breed: '', color: '', description: '', city: '', photos: [] },
  location: null,
};

export function PublishWizardPage() {
  const { t } = useTranslation('publish');
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<PublishStep>('intent');
  const [wizard, setWizard] = useState<PublishWizardState>(initialWizardState);

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
  // abandonando, y arrastrarlo a otra sería peor que perderlo. Es el mismo
  // reset que hace handlePublishAnother.
  const backToIntent = () => {
    setStep('intent');
    setWizard(initialWizardState);
    setPublishError(null);
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

  const [publishedPet, setPublishedPet] = useState<Pet | null>(null);
  const [failedPhotoIndexes, setFailedPhotoIndexes] = useState<number[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);

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

  const handlePublishAnother = () => {
    setStep('intent');
    setWizard(initialWizardState);
    setPublishedPet(null);
    setFailedPhotoIndexes([]);
    setPublishError(null);
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
            <span aria-hidden="true">←</span>
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
