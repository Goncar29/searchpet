// ============================================================
// SearchPet - Stories List Screen
// ============================================================

import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStories } from '../../../../shared/hooks';
import { getDateLocale } from '../../i18n/dateLocale';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import type { SuccessStory } from '../../../../shared/types';

export default function StoriesScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation('story');
  const { data: stories, isLoading, isError, refetch } = useStories({ limit: 20 });
  const dateLocale = getDateLocale(i18n.language);

  const renderItem = ({ item }: { item: SuccessStory }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/story/${item.id}` as any)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.petName}>{item.pet_name}</Text>
        <Text style={styles.likes}>❤️ {item.like_count}</Text>
      </View>
      {item.title ? (
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
      ) : null}
      <Text style={styles.body} numberOfLines={2}>
        {item.body.length > 100 ? item.body.slice(0, 100) + '…' : item.body}
      </Text>
      <Text style={styles.date}>
        {new Date(item.created_at).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}
      </Text>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>{t('story:loading')}</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>{t('story:loadError')}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>{t('story:retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={stories ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <Text style={styles.sectionTitle}>{t('story:title')}</Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🐾</Text>
            <Text style={styles.emptyTitle}>{t('story:emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('story:emptyText')}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  loadingText: { marginTop: SPACING.md, fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  errorIcon: { fontSize: 40, marginBottom: SPACING.sm },
  errorText: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary, marginBottom: SPACING.md, textAlign: 'center' },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.sm },
  sectionTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  list: { paddingBottom: 100 },
  card: {
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  petName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.primary,
    flex: 1,
  },
  likes: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  title: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  body: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: SPACING.sm,
  },
  date: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.xl,
  },
  emptyIcon: { fontSize: 60, marginBottom: SPACING.md },
  emptyTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});
