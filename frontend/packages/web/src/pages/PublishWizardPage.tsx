import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IntentStep } from '../components/publish/IntentStep';
import { LostPetStep } from '../components/publish/LostPetStep';
import { StrayFormStep } from '../components/publish/StrayFormStep';
import { AdoptionFormStep } from '../components/publish/AdoptionFormStep';
import { LocationStep } from '../components/publish/LocationStep';
import { SuccessStep } from '../components/publish/SuccessStep';
import { InlineAuthStep } from '../components/publish/InlineAuthStep';
import { useAuth } from '../context/AuthContext';
import { useCreatePet, usePublishLost, usePublishStray, useUploadPhoto } from '@shared/hooks';
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
  selectedPet: Pet | null;
  strayForm: StrayFormState;
  adoptionForm: AdoptionFormState;
  location: InitialReportRequest | null;
}

export const initialWizardState: PublishWizardState = {
  intent: null,
  selectedPet: null,
  strayForm: { type: '', breed: '', color: '', description: '', photos: [], contactPublic: false },
  adoptionForm: { type: '', breed: '', color: '', description: '', city: '', photos: [] },
  location: null,
};

export function PublishWizardPage() {
  const { t } = useTranslation('publish');
  const { isAuthenticated } = useAuth();
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

  const handleBackFromLocation = () => {
    setStep(wizard.intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const [publishedPet, setPublishedPet] = useState<Pet | null>(null);
  const [failedPhotoIndexes, setFailedPhotoIndexes] = useState<number[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishLost = usePublishLost();
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

    if (wizard.intent === 'lost' && wizard.selectedPet) {
      try {
        const pet = await publishLost.mutateAsync({ id: wizard.selectedPet.id, data: location });
        setPublishedPet(pet);
        setFailedPhotoIndexes([]);
        setStep('success');
      } catch (err) {
        setPublishError(getErrorMessage(err, t));
      }
      return;
    }

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {publishError && (
          <p className="text-red-500 dark:text-red-400 text-sm text-center mb-4">{publishError}</p>
        )}
        {step === 'intent' && <IntentStep onSelect={handleIntentSelect} />}
        {step === 'lost-pet' && (
          <LostPetStep
            onSelect={(pet) => {
              setWizard((prev) => ({ ...prev, selectedPet: pet }));
              setStep('location');
            }}
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
            isPending={publishLost.isPending || publishStray.isPending}
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
