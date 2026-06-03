// ============================================================
// SearchPet — Mis Badges
// Muestra los logros obtenidos por el usuario autenticado.
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store';
import { getDateLocale } from '../../i18n/dateLocale';
import { useMyBadges } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import type { Badge } from '../../../shared/types';
import { BADGE_META } from '../../../shared/types';

function BadgeCard({ badge }: { badge: Badge }) {
  const { t, i18n } = useTranslation(['badges', 'common']);
  const meta = BADGE_META[badge.badge_type];
  const label = meta ? t(meta.labelKey) : badge.badge_type;
  const description = meta ? t(meta.descriptionKey) : '';
  const dateLocale = getDateLocale(i18n.language);
  const dateStr = new Date(badge.earned_at).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <View style={styles.badgeCard}>
      <Text style={styles.badgeEmoji}>{meta?.emoji ?? '🏅'}</Text>
      <View style={styles.badgeInfo}>
        <Text style={styles.badgeLabel}>{label}</Text>
        {description ? (
          <Text style={styles.badgeDescription}>{description}</Text>
        ) : null}
        <Text style={styles.badgeDate}>{t('badges:earnedOn')} {dateStr}</Text>
      </View>
    </View>
  );
}

export default function BadgesScreen() {
  const router = useRouter();
  const { t } = useTranslation(['badges', 'common']);
  const { isAuthenticated } = useAuthStore();

  const { data: badges, isLoading, isError, refetch, isFetching } = useMyBadges();

  // Auth guard
  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <Text style={styles.guardIcon}>🔒</Text>
        <Text style={styles.guardTitle}>{t('badges:authRequired')}</Text>
        <Text style={styles.guardText}>{t('badges:authText')}</Text>
        <TouchableOpacity
          style={styles.loginButton}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.loginButtonText}>{t('badges:loginButton')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.guardIcon}>⚠️</Text>
        <Text style={styles.guardTitle}>{t('badges:loadError')}</Text>
        <Text style={styles.guardText}>{t('badges:loadErrorText')}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>{t('common:reload')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList<Badge>
        data={badges ?? []}
        keyExtractor={(item) => item.id}
        refreshing={isFetching && !isLoading}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.intro}>
            <Text style={styles.introTitle}>🏆 {t('badges:myAchievements')}</Text>
            <Text style={styles.introText}>{t('badges:introText')}</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🏅</Text>
            <Text style={styles.emptyTitle}>{t('badges:emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('badges:emptyText')}</Text>
          </View>
        }
        renderItem={({ item }) => <BadgeCard badge={item} />}
        contentContainerStyle={styles.listContent}
      />
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

  loginButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
  },
  loginButtonText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },

  retryButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: COLORS.primary, fontSize: FONTS.sizes.sm, fontWeight: '600' },

  // ── Intro banner ──
  intro: {
    margin: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: COLORS.accent + '25',
    borderRadius: RADIUS.lg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent,
  },
  introTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 },
  introText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, lineHeight: 20 },

  // ── Badge card ──
  listContent: { paddingBottom: 80 },
  badgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  badgeEmoji: { fontSize: 40, marginRight: SPACING.md },
  badgeInfo: { flex: 1 },
  badgeLabel: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary },
  badgeDescription: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  badgeDate: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: 4 },

  // ── Empty state ──
  empty: { alignItems: 'center', padding: SPACING.xl, marginTop: SPACING.lg },
  emptyIcon: { fontSize: 56, marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
});
