// ============================================================
// SearchPet — Perfil Público
// Muestra el perfil público de otro usuario: stats + badges.
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { usePublicProfile } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS, BADGE_META } from '../../constants';
import type { Badge } from '../../../shared/types';

function getInitials(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' });
}

function BadgeRow({ badge }: { badge: Badge }) {
  const meta = BADGE_META[badge.badge_type] ?? {
    emoji: '🏅',
    label: badge.badge_type,
    description: '',
  };

  return (
    <View style={styles.badgeCard}>
      <Text style={styles.badgeEmoji}>{meta.emoji}</Text>
      <View style={styles.badgeInfo}>
        <Text style={styles.badgeLabel}>{meta.label}</Text>
        {meta.description ? (
          <Text style={styles.badgeDescription}>{meta.description}</Text>
        ) : null}
        <Text style={styles.badgeDate}>Obtenido el {formatDate(badge.earned_at)}</Text>
      </View>
    </View>
  );
}

interface StatItemProps {
  value: number;
  label: string;
}

function StatItem({ value, label }: StatItemProps) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: profile, isLoading, isError, refetch, isFetching } = usePublicProfile(id ?? '');

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (isError || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.stateIcon}>🔍</Text>
        <Text style={styles.stateTitle}>{isError ? 'Error al cargar' : 'Usuario no encontrado'}</Text>
        <Text style={styles.stateText}>
          {isError
            ? 'No se pudo cargar el perfil. Intentá de nuevo.'
            : 'Este perfil no existe o fue eliminado.'}
        </Text>
        {isError && (
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Reintentar</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          colors={[COLORS.primary]}
          tintColor={COLORS.primary}
        />
      }
    >
      {/* ── User card ── */}
      <View style={styles.userCard}>
        {profile.profile_photo_url ? (
          <Image
            source={{ uri: profile.profile_photo_url }}
            style={styles.photoAvatar}
          />
        ) : (
          <View style={styles.initialsAvatar}>
            <Text style={styles.initialsText}>{getInitials(profile.name)}</Text>
          </View>
        )}
        <Text style={styles.userName}>{profile.name}</Text>
        {profile.city ? (
          <Text style={styles.userCity}>📍 {profile.city}</Text>
        ) : null}
      </View>

      {/* ── Stats grid ── */}
      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          <StatItem value={profile.total_points} label="Puntos" />
          <View style={styles.statDivider} />
          <StatItem value={profile.total_reports} label="Reportes" />
        </View>
        <View style={styles.statRowSeparator} />
        <View style={styles.statsRow}>
          <StatItem value={profile.found_count} label="Encontradas" />
          <View style={styles.statDivider} />
          <StatItem value={profile.share_count} label="Compartidas" />
        </View>
      </View>

      {/* ── Badges ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🏆 Logros</Text>

        {profile.badges.length === 0 ? (
          <View style={styles.emptyBadges}>
            <Text style={styles.emptyBadgesIcon}>🏅</Text>
            <Text style={styles.emptyBadgesText}>Este usuario aún no tiene logros</Text>
          </View>
        ) : (
          profile.badges.map((badge) => (
            <BadgeRow key={badge.id} badge={badge} />
          ))
        )}
      </View>

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },

  // ── States ──
  stateIcon: { fontSize: 56, marginBottom: SPACING.md },
  stateTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  stateText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', marginBottom: SPACING.lg },
  retryButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: COLORS.primary, fontSize: FONTS.sizes.sm, fontWeight: '600' },

  // ── User card ──
  userCard: {
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    ...SHADOWS.md,
  },
  photoAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: SPACING.md,
  },
  initialsAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.secondary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  initialsText: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  userName: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary },
  userCity: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4 },

  // ── Stats ──
  statsCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: SPACING.sm },
  statValue: { fontSize: FONTS.sizes.xxl, fontWeight: '700', color: COLORS.primary },
  statLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 4 },
  statDivider: { width: 1, height: 40, backgroundColor: COLORS.border },
  statRowSeparator: { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.xs },

  // ── Section ──
  section: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },

  // ── Badge row ──
  badgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
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

  // ── Empty badges ──
  emptyBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
    gap: SPACING.md,
  },
  emptyBadgesIcon: { fontSize: 32 },
  emptyBadgesText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
});
