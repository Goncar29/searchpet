// ============================================================
// SearchPet — Grupos Locales (List Screen)
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useAuthStore } from '../../store';
import { useGroups, useJoinGroup, useLeaveGroup } from '../../../shared/hooks';
import { getErrorMessage } from '../../../shared/utils/apiErrors';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import type { LocalGroup } from '../../../shared/types';

// ============================================================
// Group Card — owns its own mutation hooks (one instance per card)
// ============================================================

interface GroupCardProps {
  group: LocalGroup;
  isAuthenticated: boolean;
  onPress: () => void;
  onUnauthenticated: () => void;
}

function GroupCard({ group, isAuthenticated, onPress, onUnauthenticated }: GroupCardProps) {
  const { t } = useTranslation('groups');
  const joinMutation = useJoinGroup(group.id);
  const leaveMutation = useLeaveGroup(group.id);
  const isPending = joinMutation.isPending || leaveMutation.isPending;

  const handleJoin = () => {
    if (!isAuthenticated) {
      onUnauthenticated();
      return;
    }
    joinMutation.mutate(undefined, {
      onError: (err) => {
        if ((err as any).message?.includes('ya eres miembro')) return;
        Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
      },
    });
  };

  const handleLeave = () => {
    if (!isAuthenticated) {
      onUnauthenticated();
      return;
    }
    leaveMutation.mutate(undefined, {
      onError: (err) => {
        Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
      },
    });
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardIcon}>📍</Text>
          <Text style={styles.cardCity} numberOfLines={1}>{group.city}</Text>
          {group.is_member && (
            <View style={styles.memberBadge}>
              <Text style={styles.memberBadgeText}>{t('groups:member')}</Text>
            </View>
          )}
        </View>
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
              {group.is_member ? t('groups:leave') : t('groups:join')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {group.description ? (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {group.description}
        </Text>
      ) : null}

      <Text style={styles.cardMemberCount}>
        {t('groups:members', { count: group.member_count })}
      </Text>
    </TouchableOpacity>
  );
}

// ============================================================
// Main screen
// ============================================================

export default function GroupsScreen() {
  const router = useRouter();
  const { t } = useTranslation('groups');
  const { isAuthenticated } = useAuthStore();
  const [cityFilter, setCityFilter] = useState('');
  const [submittedCity, setSubmittedCity] = useState('');

  const { data: groups, isLoading, isError, refetch } = useGroups(submittedCity || undefined);

  const handleSearch = () => {
    setSubmittedCity(cityFilter.trim());
  };

  const handleUnauthenticated = () => {
    router.push('/login');
  };

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
        <Text style={styles.stateIcon}>⚠️</Text>
        <Text style={styles.stateTitle}>{t('groups:loadError')}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>{t('groups:retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* City filter */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('groups:searchPlaceholder')}
          placeholderTextColor={COLORS.placeholder}
          value={cityFilter}
          onChangeText={setCityFilter}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>{t('groups:search')}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={groups as LocalGroup[]}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <GroupCard
            group={item}
            isAuthenticated={isAuthenticated}
            onPress={() => router.push(`/groups/${item.id}` as any)}
            onUnauthenticated={handleUnauthenticated}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.stateIcon}>👥</Text>
            <Text style={styles.stateTitle}>{t('groups:emptyTitle')}</Text>
            <Text style={styles.stateText}>
              {submittedCity
                ? t('groups:emptyCity', { city: submittedCity })
                : t('groups:empty')}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    height: 40,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  searchButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
  },
  searchButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },

  // List
  list: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: 100 },

  // Card
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: SPACING.xs,
    marginRight: SPACING.sm,
  },
  cardIcon: { fontSize: 16 },
  cardCity: {
    fontSize: FONTS.sizes.md,
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
  cardDescription: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
    lineHeight: 18,
  },
  cardMemberCount: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },

  // Action button
  actionButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    minWidth: 72,
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
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  leaveButtonText: { color: COLORS.danger },

  // States
  stateIcon: { fontSize: 48, marginBottom: SPACING.sm },
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
  emptyState: {
    alignItems: 'center',
    paddingTop: SPACING.xl * 2,
  },
});
