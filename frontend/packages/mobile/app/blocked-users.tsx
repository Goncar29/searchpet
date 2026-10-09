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
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useBlockedUsers, useUnblockUser } from '../../shared/hooks';
import { ListState } from '../components/list/ListState';
import { getErrorMessage } from '../../shared/utils/apiErrors';
import { SPACING, FONTS, RADIUS, SHADOWS, type ThemeColors } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';
import { Icon } from '../components/Icon';
import type { BlockedUser } from '../../shared/types';
import { showAlert } from '../components/appAlert';

function BlockedUserItem({ item, onUnblock }: { item: BlockedUser; onUnblock: (id: string) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation(['blocked_users', 'common']);
  const initial = item.name.trim().charAt(0).toUpperCase();

  const handleUnblock = () => {
    showAlert(
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
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation(['blocked_users', 'common']);
  // La query entera: `ListState` necesita `isPaused`, `isError` y `refetch`.
  const blockedQuery = useBlockedUsers();
  const unblockUser = useUnblockUser();

  const handleUnblock = (userId: string) => {
    unblockUser.mutate(userId, {
      onError: (err: unknown) => {
        showAlert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
      },
    });
  };

  return (
    <View style={styles.container}>
      {/* El título y la flecha de volver los pone el header nativo (registrado
          en app/_layout.tsx), así que un fallo de red no deja al usuario sin la
          salida. El cartel sale sólo si no hay nada que mostrar — con `isError`
          a secas un refetch fallido borraba la lista dibujada. */}
      <ListState<BlockedUser[], BlockedUser>
        query={blockedQuery}
        loading={
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        }
      >
        {(blockedUsers) => (
      <FlatList
        data={blockedUsers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <BlockedUserItem item={item} onUnblock={handleUnblock} />
        )}
        contentContainerStyle={
          blockedUsers.length === 0 ? styles.emptyContainer : styles.listContent
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Icon name="check-circle" size={48} color={colors.success} /></View>
            <Text style={styles.emptyTitle}>{t('blocked_users:empty')}</Text>
            <Text style={styles.emptySubtitle}>{t('blocked_users:emptySubtitle')}</Text>
          </View>
        }
      />
        )}
      </ListState>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
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
    backgroundColor: c.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
    flexShrink: 0,
  },
  avatarText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: c.primary,
  },
  name: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    fontWeight: '500',
    color: c.textPrimary,
    marginRight: SPACING.sm,
  },
  unblockBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: c.primary,
  },
  unblockText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: c.primary,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyIcon: {
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: c.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  emptySubtitle: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: FONTS.sizes.md,
    color: c.textSecondary,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  backBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: c.primary,
    borderRadius: RADIUS.md,
  },
  backBtnText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: c.onPrimary,
  },
});
