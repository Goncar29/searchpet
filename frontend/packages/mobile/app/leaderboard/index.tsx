// ============================================================
// SearchPet — Tabla de Líderes
// Muestra el ranking de usuarios por puntos en una ciudad.
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useLeaderboard } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import type { LeaderboardEntry } from '../../../shared/types';

const MEDAL: Record<number, string> = {
  1: '🥇',
  2: '🥈',
  3: '🥉',
};

function getInitials(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

function LeaderboardRow({ entry, onPress }: { entry: LeaderboardEntry; onPress: () => void }) {
  const medal = MEDAL[entry.rank];

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {/* Rank */}
      <View style={styles.rankContainer}>
        {medal ? (
          <Text style={styles.medalEmoji}>{medal}</Text>
        ) : (
          <Text style={styles.rankNumber}>{entry.rank}</Text>
        )}
      </View>

      {/* Avatar */}
      <View style={[styles.avatar, medal ? styles.avatarTop3 : null]}>
        <Text style={styles.avatarText}>{getInitials(entry.name)}</Text>
      </View>

      {/* Name */}
      <Text style={styles.rowName} numberOfLines={1}>{entry.name}</Text>

      {/* Points */}
      <View style={styles.pointsContainer}>
        <Text style={styles.pointsValue}>{entry.total_points}</Text>
        <Text style={styles.pointsLabel}>pts</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function LeaderboardScreen() {
  const router = useRouter();
  const { t } = useTranslation('leaderboard');

  const [city, setCity] = useState('Montevideo');
  const [inputCity, setInputCity] = useState('Montevideo');

  const { data: entries, isLoading, isError, refetch, isFetching } = useLeaderboard(city);

  const applyCity = () => {
    const trimmed = inputCity.trim();
    if (trimmed) setCity(trimmed);
  };

  return (
    <View style={styles.container}>
      {/* City filter */}
      <View style={styles.filterContainer}>
        <Text style={styles.filterLabel}>{t('leaderboard:cityLabel')}</Text>
        <TextInput
          style={styles.filterInput}
          value={inputCity}
          onChangeText={setInputCity}
          placeholder={t('leaderboard:cityPlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          returnKeyType="search"
          onSubmitEditing={applyCity}
          onBlur={applyCity}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={styles.guardIcon}>⚠️</Text>
          <Text style={styles.guardTitle}>{t('leaderboard:loadError')}</Text>
          <Text style={styles.guardText}>{t('leaderboard:loadErrorText')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>{t('leaderboard:retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList<LeaderboardEntry>
          data={entries ?? []}
          keyExtractor={(item) => item.user_id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={styles.sectionTitle}>
              🏙️ {city}
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>{t('leaderboard:emptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('leaderboard:empty', { city })}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <LeaderboardRow
              entry={item}
              onPress={() => router.push('/users/' + item.user_id)}
            />
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },

  // ── Auth guard / Error states ──
  guardIcon: { fontSize: 56, marginBottom: SPACING.md },
  guardTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  guardText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', marginBottom: SPACING.lg },

  retryButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: COLORS.primary, fontSize: FONTS.sizes.sm, fontWeight: '600' },

  // ── City filter ──
  filterContainer: {
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  filterLabel: {
    fontSize: FONTS.sizes.xs,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterInput: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // ── List ──
  listContent: { paddingBottom: 80 },
  sectionTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    marginBottom: SPACING.md,
  },

  // ── Row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  rankContainer: { width: 32, alignItems: 'center', marginRight: SPACING.sm },
  medalEmoji: { fontSize: 22 },
  rankNumber: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textSecondary },

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.secondary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarTop3: { backgroundColor: COLORS.accent + '30' },
  avatarText: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.secondary },

  rowName: { flex: 1, fontSize: FONTS.sizes.md, fontWeight: '500', color: COLORS.textPrimary },

  pointsContainer: { alignItems: 'flex-end' },
  pointsValue: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: COLORS.primary },
  pointsLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted },

  // ── Empty state ──
  empty: { alignItems: 'center', padding: SPACING.xl, marginTop: SPACING.lg },
  emptyIcon: { fontSize: 56, marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
});
