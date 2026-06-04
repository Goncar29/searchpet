// ============================================================
// SearchPet — Shelters Screen
// Directory of verified shelters, filterable by city.
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShelters } from '../../../shared/hooks';
import { Shelter } from '../../../shared/types';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

// ============================================================
// ShelterCard — inline component
// ============================================================

type ShelterCardProps = {
  shelter: Shelter;
  t: (key: string) => string;
};

function ShelterCard({ shelter, t }: ShelterCardProps) {
  const openURL = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={styles.card}>
      {/* Header row: name + verified badge */}
      <View style={styles.cardHeader}>
        <Text style={styles.shelterName} numberOfLines={1}>
          {shelter.name}
        </Text>
        {shelter.is_verified && (
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedBadgeText}>{t('verifiedBadge')}</Text>
          </View>
        )}
      </View>

      {/* City */}
      {shelter.city ? (
        <Text style={styles.shelterCity}>📍 {shelter.city}</Text>
      ) : null}

      {/* Description */}
      {shelter.description ? (
        <Text style={styles.shelterDescription} numberOfLines={2}>
          {shelter.description}
        </Text>
      ) : null}

      {/* Contact info */}
      {shelter.phone ? (
        <Text style={styles.contactInfo}>
          {t('contactPhone')}: {shelter.phone}
        </Text>
      ) : null}
      {shelter.email ? (
        <Text style={styles.contactInfo}>
          {t('contactEmail')}: {shelter.email}
        </Text>
      ) : null}

      {/* Action buttons */}
      {(shelter.website_url || shelter.donation_url) ? (
        <View style={styles.buttonRow}>
          {shelter.website_url ? (
            <TouchableOpacity
              style={[styles.actionButton, styles.websiteButton]}
              onPress={() => openURL(shelter.website_url!)}
            >
              <Text style={styles.websiteButtonText}>{t('websiteButton')}</Text>
            </TouchableOpacity>
          ) : null}
          {shelter.donation_url ? (
            <TouchableOpacity
              style={[styles.actionButton, styles.donateButton]}
              onPress={() => openURL(shelter.donation_url!)}
            >
              <Text style={styles.donateButtonText}>{t('donateButton')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ============================================================
// SkeletonCard — loading placeholder
// ============================================================

function SkeletonCard() {
  return (
    <View style={[styles.card, styles.skeletonCard]}>
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, { width: '60%' }]} />
    </View>
  );
}

// ============================================================
// SheltersScreen
// ============================================================

export default function SheltersScreen() {
  const { t } = useTranslation('shelters');
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

  const { data: shelters, isLoading, isError, refetch } = useShelters(
    debouncedCity || undefined
  );

  const renderItem = ({ item }: { item: Shelter }) => (
    <ShelterCard shelter={item} t={t} />
  );

  const renderEmpty = () => {
    if (isLoading) return null;
    if (isError) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>{t('errorMessage')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>{t('retryButton')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>{t('emptyTitle')}</Text>
        <Text style={styles.emptyMessage}>{t('emptyMessage')}</Text>
      </View>
    );
  };

  const renderHeader = () => (
    <>
      {/* Page subtitle */}
      <Text style={styles.subtitle}>{t('subtitle')}</Text>

      {/* City filter input */}
      <TextInput
        style={styles.filterInput}
        value={cityInput}
        onChangeText={setCityInput}
        placeholder={t('filterPlaceholder')}
        placeholderTextColor={COLORS.placeholder}
        autoCapitalize="words"
        returnKeyType="search"
      />
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header with back arrow */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backArrow}>
          <Text style={styles.backArrowText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('title')}</Text>
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
          data={shelters ?? []}
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
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  shelterName: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginRight: SPACING.sm,
  },
  verifiedBadge: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  verifiedBadgeText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  shelterCity: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  shelterDescription: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: SPACING.sm,
  },
  contactInfo: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  actionButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  websiteButton: {
    backgroundColor: COLORS.secondary,
  },
  websiteButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  donateButton: {
    backgroundColor: COLORS.primary,
  },
  donateButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
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
