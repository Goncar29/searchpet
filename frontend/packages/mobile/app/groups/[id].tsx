// ============================================================
// SearchPet — Detalle de Grupo Local
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useEffect } from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useAuthStore } from '../../store';
import { getDateLocale } from '../../i18n/dateLocale';
import { useGroup, useGroupMembers, useJoinGroup, useLeaveGroup } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import type { GroupMember } from '../../../shared/types';

// ============================================================
// Helpers
// ============================================================

function getInitials(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

// ============================================================
// Member Row
// ============================================================

function MemberRow({ member }: { member: GroupMember }) {
  const { t, i18n } = useTranslation('groups');
  const dateLocale = getDateLocale(i18n.language);
  const dateStr = new Date(member.joined_at).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <View style={styles.memberRow}>
      {member.profile_photo_url ? (
        <Image source={{ uri: member.profile_photo_url }} style={styles.memberAvatar} />
      ) : (
        <View style={styles.memberAvatarInitials}>
          <Text style={styles.memberAvatarText}>{getInitials(member.name)}</Text>
        </View>
      )}
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{member.name}</Text>
        <Text style={styles.memberDate}>{t('groups:memberSince', { date: dateStr })}</Text>
      </View>
    </View>
  );
}

// ============================================================
// Main screen
// ============================================================

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const { t } = useTranslation('groups');
  const { isAuthenticated } = useAuthStore();

  const { data: group, isLoading: groupLoading, isError: groupError } = useGroup(id ?? '');
  const { data: members, isLoading: membersLoading } = useGroupMembers(id ?? '');
  const joinMutation = useJoinGroup(id ?? '');
  const leaveMutation = useLeaveGroup(id ?? '');

  const isPending = joinMutation.isPending || leaveMutation.isPending;

  useEffect(() => {
    if (group?.city) {
      navigation.setOptions({ title: group.city });
    }
  }, [group?.city]);

  const handleJoin = () => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    joinMutation.mutate(undefined, {
      onError: (err: any) => {
        if (err.message?.includes('ya eres miembro')) return;
        Alert.alert('Error', err.message || i18next.t('groups:joinError'));
      },
    });
  };

  const handleLeave = () => {
    leaveMutation.mutate(undefined, {
      onError: (err: any) => {
        Alert.alert('Error', err.message || i18next.t('groups:leaveError'));
      },
    });
  };

  if (groupLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (groupError || !group) {
    return (
      <View style={styles.center}>
        <Text style={styles.stateIcon}>🔍</Text>
        <Text style={styles.stateTitle}>{t('groups:notFound')}</Text>
        <Text style={styles.stateText}>{t('groups:notFoundText')}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
          <Text style={styles.retryButtonText}>{t('groups:back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Group header */}
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <Text style={styles.headerIcon}>📍</Text>
          <Text style={styles.headerCity}>{group.city}</Text>
          {group.is_member && (
            <View style={styles.memberBadge}>
              <Text style={styles.memberBadgeText}>{t('groups:isMember')}</Text>
            </View>
          )}
        </View>

        {group.description ? (
          <Text style={styles.headerDescription}>{group.description}</Text>
        ) : null}

        <Text style={styles.headerMemberCount}>
          {t('groups:members', { count: group.member_count })}
        </Text>

        {/* Join / Leave button */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            group.is_member ? styles.leaveButton : styles.joinButton,
            isPending && styles.actionButtonDisabled,
          ]}
          onPress={group.is_member ? handleLeave : handleJoin}
          disabled={isPending}
        >
          {isPending ? (
            <ActivityIndicator
              size="small"
              color={group.is_member ? COLORS.danger : COLORS.white}
            />
          ) : (
            <Text style={[styles.actionButtonText, group.is_member && styles.leaveButtonText]}>
              {group.is_member ? t('groups:leaveGroup') : t('groups:joinGroup')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Members list */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>👥 {t('groups:membersTitle')}</Text>

        {membersLoading ? (
          <ActivityIndicator
            size="small"
            color={COLORS.primary}
            style={{ marginTop: SPACING.md }}
          />
        ) : !members || members.length === 0 ? (
          <View style={styles.emptyMembers}>
            <Text style={styles.stateIcon}>🤷</Text>
            <Text style={styles.stateText}>{t('groups:noMembers')}</Text>
          </View>
        ) : (
          members.map((member) => (
            <MemberRow key={member.user_id} member={member} />
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

  // Header card
  headerCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
    flexWrap: 'wrap',
  },
  headerIcon: { fontSize: 20 },
  headerCity: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    flex: 1,
  },
  memberBadge: {
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  memberBadgeText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.primary,
    fontWeight: '600',
  },
  headerDescription: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: SPACING.sm,
  },
  headerMemberCount: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
  },

  // Action button
  actionButton: {
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  joinButton: { backgroundColor: COLORS.primary },
  leaveButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  actionButtonDisabled: { opacity: 0.6 },
  actionButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  leaveButtonText: { color: COLORS.danger },

  // Section
  section: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },

  // Member row
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
    gap: SPACING.md,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  memberAvatarInitials: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.secondary + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAvatarText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  memberInfo: { flex: 1 },
  memberName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  memberDate: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },

  // States
  stateIcon: { fontSize: 48, marginBottom: SPACING.sm, textAlign: 'center' },
  stateTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  stateText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: COLORS.primary, fontSize: FONTS.sizes.sm, fontWeight: '600' },
  emptyMembers: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
});
