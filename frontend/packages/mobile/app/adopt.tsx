// ============================================================
// SearchPet - Adoptar Screen
// Directorio de mascotas en adopción, filtrable por ciudad y tipo.
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAdoptions } from '../../shared/hooks';
import { PetCard } from '../components/PetCard';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS, PET_TYPES } from '../constants';
import type { Pet, PetType } from '../../shared/types';

export default function AdoptScreen() {
  const router = useRouter();
  const { t } = useTranslation(['adoption', 'pets', 'common']);

  // ── Filtros (draft state — editado libremente, no dispara la API) ──
  const [draftCity, setDraftCity] = useState('');
  const [draftType, setDraftType] = useState<PetType | undefined>();

  // ── Applied state — recién acá se dispara useAdoptions ──
  const [appliedCity, setAppliedCity] = useState<string | undefined>();
  const [appliedType, setAppliedType] = useState<PetType | undefined>();

  const applyFilters = () => {
    setAppliedCity(draftCity.trim() || undefined);
    setAppliedType(draftType);
  };

  const { data, isLoading } = useAdoptions({ city: appliedCity, type: appliedType });
  const pets = data?.data ?? [];
  const count = data?.total ?? pets.length;

  const handlePetPress = (petId: string) => router.push(`/pet/${petId}`);

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>{t('adoption:section.title')}</Text>
        <Text style={styles.subtitle}>{t('adoption:section.subtitle')}</Text>
      </View>

      <View style={styles.filterCard}>
        <TextInput
          style={styles.cityInput}
          placeholder={t('adoption:section.cityPlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          accessibilityLabel={t('adoption:section.cityFilter')}
          value={draftCity}
          onChangeText={setDraftCity}
          returnKeyType="search"
          onSubmitEditing={applyFilters}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          accessibilityLabel={t('adoption:section.typeFilter')}
        >
          <TouchableOpacity
            style={[styles.chip, !draftType && styles.chipActive]}
            onPress={() => setDraftType(undefined)}
          >
            <Text style={[styles.chipText, !draftType && styles.chipTextActive]}>
              🐾 {t('adoption:section.allTypes')}
            </Text>
          </TouchableOpacity>

          {PET_TYPES.map((petType) => (
            <TouchableOpacity
              key={petType.value}
              style={[styles.chip, draftType === petType.value && styles.chipActive]}
              onPress={() =>
                setDraftType(draftType === petType.value ? undefined : (petType.value as PetType))
              }
            >
              <Text
                style={[styles.chipText, draftType === petType.value && styles.chipTextActive]}
              >
                {petType.icon} {t(`pets:types.${petType.value}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity style={styles.applyButton} onPress={applyFilters}>
          <Text style={styles.applyButtonText}>{t('adoption:section.apply')}</Text>
        </TouchableOpacity>
      </View>

      {!isLoading && (
        <Text style={styles.resultCount}>
          {t('adoption:section.resultCount', { count })}
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={pets}
        keyExtractor={(item: Pet) => item.id}
        renderItem={({ item }: { item: Pet }) => (
          <PetCard pet={item} onPress={() => handlePetPress(item.id)} />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🐾</Text>
              <Text style={styles.emptyText}>{t('adoption:section.empty')}</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { paddingVertical: SPACING.xxl * 2, alignItems: 'center' },

  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4 },

  // ── Filtros ──
  filterCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    ...SHADOWS.sm,
  },
  cityInput: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  chipsRow: {
    gap: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  applyButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  applyButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.sm },

  resultCount: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },

  // ── Lista ──
  list: { paddingHorizontal: SPACING.lg, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxl * 2 },
  emptyIcon: { fontSize: 60, marginBottom: SPACING.md },
  emptyText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', paddingHorizontal: SPACING.xl },
});
