import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IntentStep } from '../components/publish/IntentStep';
import { LostPetStep } from '../components/publish/LostPetStep';
import { StrayFormStep } from '../components/publish/StrayFormStep';
import { LocationStep } from '../components/publish/LocationStep';
import { useAuth } from '../context/AuthContext';
import type { Pet, CreatePetRequest, InitialReportRequest } from '@shared/types';

export type PublishStep = 'intent' | 'lost-pet' | 'stray-form' | 'location' | 'auth' | 'success';
export type PublishIntent = 'lost' | 'stray';

export interface StrayFormState {
  type: CreatePetRequest['type'] | '';
  breed: string;
  color: string;
  description: string;
  photos: File[];
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
  strayForm: { type: '', breed: '', color: '', description: '', photos: [] },
  location: null,
};

export function PublishWizardPage() {
  const { t } = useTranslation('publish');
  const { isAuthenticated } = useAuth();
  const [step, setStep] = useState<PublishStep>('intent');
  const [wizard, setWizard] = useState<PublishWizardState>(initialWizardState);

  const handleIntentSelect = (intent: PublishIntent) => {
    setWizard((prev) => ({ ...prev, intent }));
    setStep(intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const handleBackFromLocation = () => {
    setStep(wizard.intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const handlePublish = (location: typeof wizard.location) => {
    setWizard((prev) => ({ ...prev, location }));
    if (!isAuthenticated && wizard.intent === 'stray') {
      setStep('auth');
      return;
    }
    setStep('success');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
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
            isPending={false}
          />
        )}
        {step === 'auth' && <p>{t('auth.title')}</p>}
        {step === 'success' && <p>publish:success placeholder</p>}
      </div>
    </div>
  );
}
