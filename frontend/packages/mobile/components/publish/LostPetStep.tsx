import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMyPets } from '@shared/hooks';
import type { Pet, Photo } from '../../../shared/types';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';

interface LostPetStepProps {
  onSelect: (pet: Pet) => void;
}

export function LostPetStep({ onSelect }: LostPetStepProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: pets, isLoading } = useMyPets();

  const eligiblePets = (pets ?? []).filter((pet: Pet) => pet.status === 'registered');

  if (isLoading) {
    return <Text style={styles.loading}>{t('common:loading')}</Text>;
  }

  if (eligiblePets.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t('publish:lostPet.empty')}</Text>
        <TouchableOpacity
          style={styles.emptyButton}
          onPress={() => router.push('/my-pets')}
          accessibilityRole="button"
        >
          <Text style={styles.emptyButtonText}>{t('publish:lostPet.emptyAction')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.title}>{t('publish:lostPet.title')}</Text>
      {eligiblePets.map((pet: Pet) => {
        const primaryPhoto: Photo | undefined =
          pet.photos?.find((p) => p.is_primary) ?? pet.photos?.[0];

        return (
          <TouchableOpacity
            key={pet.id}
            style={styles.row}
            onPress={() => onSelect(pet)}
            accessibilityRole="button"
          >
            {primaryPhoto ? (
              <Image source={{ uri: primaryPhoto.url }} style={styles.thumb} />
            ) : (
              <View style={styles.thumbPlaceholder}>
                <Text style={styles.thumbPlaceholderText}>🐾</Text>
              </View>
            )}
            <View style={styles.rowInfo}>
              <Text style={styles.rowName}>{pet.name}</Text>
              <Text style={styles.rowType}>{t(`pets:types.${pet.type}`)}</Text>
            </View>
            <Text style={styles.selectLabel}>{t('publish:lostPet.select')}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.lg, textAlign: 'center' },
  loading: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.lg },
  emptyContainer: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, marginBottom: SPACING.md, textAlign: 'center' },
  emptyButton: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg },
  emptyButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.md, marginRight: SPACING.md },
  thumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.md,
    marginRight: SPACING.md,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderText: { fontSize: 24 },
  rowInfo: { flex: 1 },
  rowName: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary },
  rowType: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: SPACING.xs },
  selectLabel: { color: COLORS.primary, fontWeight: '700', fontSize: FONTS.sizes.sm },
});
