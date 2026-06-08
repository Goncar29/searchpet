// ============================================================
// SearchPet — Usuarios Bloqueados
// Manage the list of blocked users: view and unblock.
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useBlockedUsers, useUnblockUser } from '../../shared/hooks';
import { getErrorMessage } from '../../shared/utils/apiErrors';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import type { BlockedUser } from '../../shared/types';

function BlockedUserItem({ item, onUnblock }: { item: BlockedUser; onUnblock: (id: string) => void }) {
  const { t } = useTranslation(['blocked_users', 'common']);
  const initial = item.name.trim().charAt(0).toUpperCase();

  const handleUnblock = () => {
    Alert.alert(
      i18next.t('blocked_users:unblockConfirm'),
      item.name,
      [
        { text: i18next.t('common:cancel'), style: 'cancel' },
        {
          text: i18next.t('blocked_users:unblock'),
          style: 'default',
          onPress: () => onUnblock(item.blocked_id),
        },
      ],
    );
  };

  return (
    <View style={styles.item}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
      <TouchableOpacity style={styles.unblockBtn} onPress={handleUnblock}>
        <Text style={styles.unblockText}>{t('blocked_users:unblock')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function BlockedUsersScreen() {
  const router = useRouter();
  const { t } = useTranslation(['blocked_users', 'common']);
  const { data: blockedUsers, isLoading, isError } = useBlockedUsers();
  const unblockUser = useUnblockUser();

  const handleUnblock = (userId: string) => {
    unblockUser.mutate(userId, {
      onError: (err: unknown) => {
        Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
      },
    });
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
        <Text style={styles.errorText}>{t('blocked_users:loadError')}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>{t('blocked_users:back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backArrow}>
          <Text style={styles.backArrowText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('blocked_users:title')}</Text>
      </View>

      <FlatList
        data={blockedUsers ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <BlockedUserItem item={item} onUnblock={handleUnblock} />
        )}
        contentContainerStyle={
          (blockedUsers ?? []).length === 0 ? styles.emptyContainer : styles.listContent
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>{t('blocked_users:empty')}</Text>
            <Text style={styles.emptySubtitle}>{t('blocked_users:emptySubtitle')}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.md,
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
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  listContent: {
    padding: SPACING.md,
  },
  emptyContainer: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
    flexShrink: 0,
  },
  avatarText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.primary,
  },
  name: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    fontWeight: '500',
    color: COLORS.textPrimary,
    marginRight: SPACING.sm,
  },
  unblockBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  unblockText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.primary,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  emptySubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  backBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
  },
  backBtnText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: '#fff',
  },
});
