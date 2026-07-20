// ============================================================
// SearchPet — Foster Homes Screen
// Directory of approved foster homes, filterable by city.
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFosterHomes } from '@shared/hooks';
import { FosterHome } from '@shared/types';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

// ============================================================
// FosterHomeCard — inline component
// ============================================================

type FosterHomeCardProps = {
  fosterHome: FosterHome;
  t: (key: string) => string;
  onPress: () => void;
};

function FosterHomeCard({ fosterHome, t, onPress }: FosterHomeCardProps) {
  const photo = fosterHome.photos?.[0];

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      {/* Photo or placeholder */}
      {photo ? (
        <Image source={{ uri: photo.url }} style={styles.cardImage} />
      ) : (
        <View style={styles.cardImagePlaceholder}>
          <Text style={{ fontSize: 40 }}>🏠</Text>
        </View>
      )}

      {/* City */}
      <Text style={styles.fosterHomeCity}>📍 {fosterHome.city}</Text>

      {/* Housing type */}
      <Text style={styles.housingType}>
        {t(`fosterHomes:housingType.${fosterHome.housing_type}`)}
      </Text>

      {/* Animal type chips */}
      <View style={styles.chipRow}>
        {fosterHome.animal_types.map((animalType) => (
          <View key={animalType} style={styles.chip}>
            <Text style={styles.chipText}>
              {t(`fosterHomes:animalType.${animalType}`)}
            </Text>
          </View>
        ))}
      </View>

      {/* Capacity */}
      <Text style={styles.capacity}>
        {t('fosterHomes:directory.capacity')}: {fosterHome.capacity}
      </Text>

      {/* Description */}
      {fosterHome.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {fosterHome.description}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ============================================================
// SkeletonCard — loading placeholder
// ============================================================

function SkeletonCard() {
  return (
    <View style={[styles.card, styles.skeletonCard]}>
      <View style={styles.skeletonImage} />
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, { width: '60%' }]} />
    </View>
  );
}

// ============================================================
// FosterHomesScreen
// ============================================================

export default function FosterHomesScreen() {
  const { t } = useTranslation('fosterHomes');
  const router = useRouter();

  const [cityInput, setCityInput] = useState('');
  const [debouncedCity, setDebouncedCity] = useState('');

  // 500ms debounce on city filter
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCity(cityInput.trim());
    }, 500);
    return () => clearTimeout(timer);
  }, [cityInput]);

  const { data: fosterHomes, isLoading, isError, refetch } = useFosterHomes(
    debouncedCity || undefined,
    undefined
  );

  const renderItem = ({ item }: { item: FosterHome }) => (
    <FosterHomeCard
      fosterHome={item}
      t={t}
      onPress={() => router.push(`/foster-home/${item.id}` as `/${string}`)}
    />
  );

  const renderEmpty = () => {
    if (isLoading) return null;
    if (isError) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>{t('common:error')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>{t('common:reload')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyMessage}>{t('fosterHomes:directory.empty')}</Text>
      </View>
    );
  };

  const renderHeader = () => (
    <>
      {/* Page subtitle */}
      <Text style={styles.subtitle}>{t('fosterHomes:directory.subtitle')}</Text>

      {/* City filter input */}
      <TextInput
        style={styles.filterInput}
        value={cityInput}
        onChangeText={setCityInput}
        placeholder={t('fosterHomes:directory.filterPlaceholder')}
        placeholderTextColor={COLORS.placeholder}
        autoCapitalize="words"
        returnKeyType="search"
      />

      {/* Register CTA */}
      <TouchableOpacity
        style={styles.registerButton}
        onPress={() => router.push('/foster-homes/register' as `/${string}`)}
      >
        <Text style={styles.registerButtonText}>
          {t('fosterHomes:directory.registerCta')}
        </Text>
      </TouchableOpacity>
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header with back arrow */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backArrow}>
          <Text style={styles.backArrowText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('fosterHomes:directory.title')}</Text>
      </View>

      {/* Loading state: show skeleton cards */}
      {isLoading ? (
        <View style={styles.listContent}>
          {renderHeader()}
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <ActivityIndicator
            color={COLORS.primary}
            style={{ marginTop: SPACING.md }}
          />
        </View>
      ) : (
        <FlatList
          data={fosterHomes ?? []}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backArrow: {
    marginRight: SPACING.sm,
    padding: SPACING.xs,
  },
  backArrowText: {
    fontSize: 28,
    color: COLORS.primary,
    lineHeight: 32,
  },
  headerTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
    lineHeight: 20,
  },
  filterInput: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  registerButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  registerButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  cardImage: {
    width: '100%',
    height: 140,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm,
  },
  cardImagePlaceholder: {
    width: '100%',
    height: 140,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fosterHomeCity: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  housingType: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  chip: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  chipText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  capacity: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  description: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  emptyTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  emptyMessage: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  // Skeleton styles
  skeletonCard: {
    opacity: 0.5,
  },
  skeletonImage: {
    width: '100%',
    height: 140,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm,
  },
  skeletonTitle: {
    height: 18,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.sm,
    width: '60%',
    marginBottom: SPACING.sm,
  },
  skeletonLine: {
    height: 14,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.sm,
    width: '90%',
    marginBottom: SPACING.xs,
  },
});
