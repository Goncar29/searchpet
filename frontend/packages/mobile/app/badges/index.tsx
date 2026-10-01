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
import { ListState } from '../../components/list/ListState';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import { IconLabel } from '../../components/IconLabel';
import type { Badge } from '../../../shared/types';
import { BADGE_META, BADGE_FALLBACK_ICON } from '../../../shared/types';
import { Icon } from '../../components/Icon';

function BadgeCard({ badge }: { badge: Badge }) {
  const { t, i18n } = useTranslation(['badges', 'common']);
  const meta = BADGE_META[badge.badge_type];
  const label = meta ? t(meta.labelKey) : badge.badge_type;
  const description = meta ? t(meta.descriptionKey) : '';
  const dateLocale = getDateLocale(i18n.language);
  const dateStr = new Date(badge.earned_at).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <View style={styles.badgeCard}>
      <View style={styles.badgeIcon}>
        <Icon name={meta?.icon ?? BADGE_FALLBACK_ICON} size={40} color={COLORS.primary} />
      </View>
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

  // La query entera: `ListState` necesita `isPaused`, `isError` y `refetch`.
  const badgesQuery = useMyBadges();
  const { isLoading, isFetching, refetch } = badgesQuery;

  // Auth guard
  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <View style={styles.guardIcon}><Icon name="lock" size={56} color={COLORS.textMuted} /></View>
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

  return (
    <View style={styles.container}>
      {/* El cartel de error aparece SÓLO si no hay nada que mostrar. Antes era
          un early return con `isError` a secas: React Query conserva lo
          cacheado cuando falla un refetch, y esta pantalla tiene
          pull-to-refresh, así que un 502 pasajero borraba los logros que el
          usuario estaba mirando. Ahora eso cae en la franja de "datos de hace
          un rato" y la lista se queda.

          Los genéricos van explícitos: sin ellos `TItem` infiere `unknown` y la
          `FlatList` tira TS2769, que jest no ve porque Babel no chequea tipos. */}
      <ListState<Badge[], Badge>
        query={badgesQuery}
        loading={
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        }
      >
        {(badges) => (
      <FlatList<Badge>
        data={badges}
        keyExtractor={(item) => item.id}
        refreshing={isFetching && !isLoading}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.intro}>
            <IconLabel icon="emoji-events" size={20} color={COLORS.textPrimary} gap={SPACING.xs} style={{ marginBottom: 4 }}>
              <Text style={[styles.introTitle, { marginBottom: 0 }]}>{t('badges:myAchievements')}</Text>
            </IconLabel>
            <Text style={styles.introText}>{t('badges:introText')}</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Icon name="military-tech" size={56} color={COLORS.textMuted} /></View>
            <Text style={styles.emptyTitle}>{t('badges:emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('badges:emptyText')}</Text>
          </View>
        }
        renderItem={({ item }) => <BadgeCard badge={item} />}
        contentContainerStyle={styles.listContent}
      />
        )}
      </ListState>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },

  // ── Auth guard / Error states ──
  guardIcon: { marginBottom: SPACING.md },
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
  badgeIcon: { marginRight: SPACING.md },
  badgeInfo: { flex: 1 },
  badgeLabel: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary },
  badgeDescription: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  badgeDate: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: 4 },

  // ── Empty state ──
  empty: { alignItems: 'center', padding: SPACING.xl, marginTop: SPACING.lg },
  emptyIcon: { marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
});
