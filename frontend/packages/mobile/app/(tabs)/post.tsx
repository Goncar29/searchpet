// ============================================================
// SearchPet - Post Tab (Publish wizard: lost pet or stray sighting)
// ============================================================

import { useState } from 'react';
import { View, ScrollView, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { IntentStep } from '../../components/publish/IntentStep';
import { LostPetStep } from '../../components/publish/LostPetStep';
import { StrayFormStep } from '../../components/publish/StrayFormStep';
import { LocationStep } from '../../components/publish/LocationStep';
import { usePublishLost, usePublishStrayNative } from '@shared/hooks';
import { useAuthStore } from '../../store';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { COLORS, SPACING, FONTS } from '../../constants';
import type { Pet, CreatePetRequest, InitialReportRequest, PetType } from '../../../shared/types';

export type PublishStep = 'intent' | 'lost-pet' | 'stray-form' | 'location' | 'auth' | 'success';
export type PublishIntent = 'lost' | 'stray';

export interface StrayFormState {
  type: PetType | '';
  breed: string;
  color: string;
  description: string;
  photos: string[]; // local URIs from expo-image-picker
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

export default function PostScreen() {
  const { t } = useTranslation();
  const [step, setStep] = useState<PublishStep>('intent');
  const [wizard, setWizard] = useState<PublishWizardState>(initialWizardState);
  const { isAuthenticated } = useAuthStore();
  const [publishedPet, setPublishedPet] = useState<Pet | null>(null);
  const [failedPhotoIndexes, setFailedPhotoIndexes] = useState<number[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishLost = usePublishLost();
  const publishStray = usePublishStrayNative();

  const handleIntentSelect = (intent: PublishIntent) => {
    setWizard((prev) => ({ ...prev, intent }));
    setStep(intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const handleBackFromLocation = () => {
    setStep(wizard.intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const submitStray = async (location: NonNullable<typeof wizard.location>) => {
    try {
      const result = await publishStray.mutateAsync({
        pet: {
          name: t('publish:strayForm.unnamedPet'),
          type: wizard.strayForm.type as Pet['type'],
          breed: wizard.strayForm.breed.trim() || undefined,
          color: wizard.strayForm.color.trim() || undefined,
          description: wizard.strayForm.description.trim() || undefined,
          status: 'stray',
          initial_report: location,
        },
        photoUris: wizard.strayForm.photos,
      });
      setPublishedPet(result.pet);
      setFailedPhotoIndexes(result.failedPhotoIndexes);
      setStep('success');
    } catch (err) {
      setPublishError(getErrorMessage(err, (key) => t(key)));
    }
  };

  const handlePublish = async (location: NonNullable<typeof wizard.location>) => {
    setWizard((prev) => ({ ...prev, location }));
    setPublishError(null);

    if (wizard.intent === 'lost' && wizard.selectedPet) {
      try {
        const pet = await publishLost.mutateAsync({ id: wizard.selectedPet.id, data: location });
        setPublishedPet(pet);
        setFailedPhotoIndexes([]);
        setStep('success');
      } catch (err) {
        setPublishError(getErrorMessage(err, (key) => t(key)));
      }
      return;
    }

    if (!isAuthenticated && wizard.intent === 'stray') {
      setStep('auth');
      return;
    }

    await submitStray(location);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View>
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
        {publishError && <Text style={styles.error}>{publishError}</Text>}
        {step === 'location' && (
          <LocationStep
            value={wizard.location}
            onPublish={handlePublish}
            onBack={handleBackFromLocation}
            isPending={publishLost.isPending || publishStray.isPending}
          />
        )}
        {step === 'auth' && <Text>{t('publish:auth.title')}</Text>}
        {step === 'success' && <Text>{t(wizard.intent === 'lost' ? 'publish:success.lostTitle' : 'publish:success.strayTitle')}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg },
  error: { fontSize: FONTS.sizes.sm, color: COLORS.danger, textAlign: 'center', marginBottom: SPACING.md },
});
