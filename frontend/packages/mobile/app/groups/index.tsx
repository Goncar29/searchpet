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
import { ListState } from '../../components/list/ListState';
import { getErrorMessage } from '../../../shared/utils/apiErrors';
import { SPACING, FONTS, RADIUS, SHADOWS, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { Icon } from '../../components/Icon';
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
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
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
          <Icon name="location-on" size={16} color={colors.primary} />
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
              color={group.is_member ? colors.danger : colors.onPrimary}
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
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('groups');
  const { isAuthenticated } = useAuthStore();
  const [cityFilter, setCityFilter] = useState('');
  const [submittedCity, setSubmittedCity] = useState('');

  // La query entera: `ListState` necesita `isPaused`, `isError` y `refetch`.
  const groupsQuery = useGroups(submittedCity || undefined);

  const handleSearch = () => {
    setSubmittedCity(cityFilter.trim());
  };

  const handleUnauthenticated = () => {
    router.push('/login');
  };

  return (
    <View style={styles.container}>
      {/* City filter */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('groups:searchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={cityFilter}
          onChangeText={setCityFilter}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>{t('groups:search')}</Text>
        </TouchableOpacity>
      </View>

      {/* El buscador queda AFUERA a propósito: antes vivía debajo del early
          return de error, así que un fallo de red se llevaba puesta la única
          forma de reintentar con otra ciudad.

          Y el cartel sale sólo si no hay nada que mostrar: con `isError` a
          secas, un refetch fallido borraba los grupos ya dibujados. De paso se
          va el `as LocalGroup[]`, un cast que escondía el `undefined`. */}
      <ListState<LocalGroup[], LocalGroup>
        query={groupsQuery}
        loading={
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        }
      >
        {(groups) => (
      <FlatList
        data={groups}
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
            <View style={styles.stateIcon}><Icon name="group" size={48} color={colors.textMuted} /></View>
            <Text style={styles.stateTitle}>{t('groups:emptyTitle')}</Text>
            <Text style={styles.stateText}>
              {submittedCity
                ? t('groups:emptyCity', { city: submittedCity })
                : t('groups:empty')}
            </Text>
          </View>
        }
      />
        )}
      </ListState>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  searchInput: {
    flex: 1,
    height: 40,
    backgroundColor: c.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.sizes.sm,
    color: c.textPrimary,
  },
  searchButton: {
    backgroundColor: c.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
  },
  searchButtonText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },

  // List
  list: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: 100 },

  // Card
  card: {
    backgroundColor: c.card,
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
  cardCity: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: c.textPrimary,
    flex: 1,
  },
  memberBadge: {
    backgroundColor: c.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  memberBadgeText: {
    fontSize: FONTS.sizes.xs,
    color: c.primary,
    fontWeight: '600',
  },
  cardDescription: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    marginBottom: SPACING.xs,
    lineHeight: 18,
  },
  cardMemberCount: {
    fontSize: FONTS.sizes.xs,
    color: c.textMuted,
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
  joinButton: { backgroundColor: c.primary },
  leaveButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: c.danger,
  },
  actionButtonDisabled: { opacity: 0.6 },
  actionButtonText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  leaveButtonText: { color: c.danger },

  // States
  stateIcon: { marginBottom: SPACING.sm },
  stateTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: c.textPrimary,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  stateText: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: c.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: c.primary, fontSize: FONTS.sizes.sm, fontWeight: '600' },
  emptyState: {
    alignItems: 'center',
    paddingTop: SPACING.xl * 2,
  },
});
