import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IntentStep } from '../components/publish/IntentStep';
import { LostPetStep } from '../components/publish/LostPetStep';
import { StrayFormStep } from '../components/publish/StrayFormStep';
import { LocationStep } from '../components/publish/LocationStep';
import { SuccessStep } from '../components/publish/SuccessStep';
import { InlineAuthStep } from '../components/publish/InlineAuthStep';
import { useAuth } from '../context/AuthContext';
import { usePublishLost, usePublishStray, useUploadPhoto } from '@shared/hooks';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { Pet, CreatePetRequest, InitialReportRequest } from '@shared/types';

export type PublishStep = 'intent' | 'lost-pet' | 'stray-form' | 'location' | 'auth' | 'success';
export type PublishIntent = 'lost' | 'stray';

export interface StrayFormState {
  type: CreatePetRequest['type'] | '';
  breed: string;
  color: string;
  description: string;
  photos: File[];
  // Opt-in: expose the reporter's WhatsApp publicly so logged-out finders can reach them.
  contactPublic: boolean;
}

export interface PublishWizardState {
  intent: PublishIntent | null;
  selectedPet: Pet | null;
  strayForm: StrayFormState;
  location: InitialReportRequest | null;
}

export const initialWizardState: PublishWizardState = {
  intent: null,
  selectedPet: null,
  strayForm: { type: '', breed: '', color: '', description: '', photos: [], contactPublic: false },
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
    setStep(intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const handleBackFromLocation = () => {
    setStep(wizard.intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const [publishedPet, setPublishedPet] = useState<Pet | null>(null);
  const [failedPhotoIndexes, setFailedPhotoIndexes] = useState<number[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishLost = usePublishLost();
  const publishStray = usePublishStray();
  const uploadPhoto = useUploadPhoto();

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
    const stillFailed: number[] = [];
    let retriedAny = false;
    for (const index of failedPhotoIndexes) {
      const file = wizard.strayForm.photos[index];
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
