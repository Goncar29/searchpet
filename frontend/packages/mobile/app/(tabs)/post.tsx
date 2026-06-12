// ============================================================
// SearchPet - Post Tab (Publish wizard: lost pet or stray sighting)
// ============================================================

import { useState } from 'react';
import { View, ScrollView, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { IntentStep } from '../../components/publish/IntentStep';
import { COLORS, SPACING } from '../../constants';
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

  const handleIntentSelect = (intent: PublishIntent) => {
    setWizard((prev) => ({ ...prev, intent }));
    setStep(intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View>
        {step === 'intent' && <IntentStep onSelect={handleIntentSelect} />}
        {step === 'lost-pet' && <Text>{t('publish:lostPet.title')}</Text>}
        {step === 'stray-form' && <Text>{t('publish:strayForm.title')}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg },
});
