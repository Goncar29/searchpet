// ============================================================
// SearchPet - Success Step (publish wizard)
// ============================================================

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { ShareButton } from '../ShareButton';
import { useUploadPhotoNative } from '@shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';
import type { Pet } from '../../../shared/types';

interface SuccessStepProps {
  pet: Pet;
  intent: 'lost' | 'stray';
  failedPhotoIndexes: number[];
  photoUris: string[];
  onRetryComplete: (stillFailedIndexes: number[]) => void;
}

export function SuccessStep({ pet, intent, failedPhotoIndexes, photoUris, onRetryComplete }: SuccessStepProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const uploadPhoto = useUploadPhotoNative();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetryPhotos = async () => {
    setIsRetrying(true);
    const stillFailed: number[] = [];
    for (const index of failedPhotoIndexes) {
      const uri = photoUris[index];
      if (!uri) continue;
      try {
        await uploadPhoto.mutateAsync({ petId: pet.id, uri });
      } catch {
        stillFailed.push(index);
      }
    }
    setIsRetrying(false);
    onRetryComplete(stillFailed);
  };

  return (
    <View>
      <Text style={styles.icon}>✅</Text>
      <Text style={styles.title}>
        {t(intent === 'lost' ? 'publish:success.lostTitle' : 'publish:success.strayTitle')}
      </Text>
      <Text style={styles.petName}>{pet.name}</Text>
      <Text style={styles.description}>
        {t(intent === 'lost' ? 'publish:success.lostDescription' : 'publish:success.strayDescription')}
      </Text>

      {failedPhotoIndexes.length > 0 && (
        <View style={styles.retryCard}>
          <Text style={styles.retryTitle}>
            {t('publish:success.photoRetryTitle', { count: failedPhotoIndexes.length })}
          </Text>
          <TouchableOpacity onPress={handleRetryPhotos} disabled={isRetrying} style={styles.retryButton}>
            {isRetrying ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Text style={styles.retryButtonText}>{t('publish:success.photoRetryAction')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <ShareButton
        petId={pet.id}
        petName={pet.name}
        petType={pet.type}
        status={pet.status === 'lost' ? 'lost' : 'sighting'}
        pet={pet}
      />

      <TouchableOpacity style={styles.feedButton} onPress={() => router.replace('/(tabs)')}>
        <Text style={styles.feedButtonText}>{t('publish:success.goToFeed')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 48, textAlign: 'center', marginBottom: SPACING.sm },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  petName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  description: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  retryCard: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    alignItems: 'center',
  },
  retryTitle: {
    fontSize: FONTS.sizes.sm,
    color: '#92400e',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  retryButton: { paddingVertical: SPACING.xs },
  retryButtonText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: '#92400e',
    textDecorationLine: 'underline',
  },
  feedButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  feedButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
});
