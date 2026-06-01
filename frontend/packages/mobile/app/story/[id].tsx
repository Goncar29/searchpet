// ============================================================
// SearchPet - Story Detail Screen
// ============================================================

import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStory, useLikeStory } from '../../../../shared/hooks';
import { useAuthStore } from '../../store';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

export default function StoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { data: story, isLoading, isError } = useStory(id ?? '');
  const likeStory = useLikeStory();

  const handleLike = () => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!story?.id) return;
    likeStory.mutate(story.id);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Cargando historia...</Text>
      </View>
    );
  }

  if (isError || !story) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>😢</Text>
        <Text style={styles.errorTitle}>Historia no encontrada</Text>
        <Text style={styles.errorText}>
          Esta historia no existe o fue eliminada.
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const authorName = story.user_name ?? (story as Record<string, unknown>).hero_name as string | undefined;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Back navigation */}
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
        <Text style={styles.backChevron}>‹</Text>
        <Text style={styles.backLabel}>Historias</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        {/* Pet name badge */}
        <View style={styles.petBadge}>
          <Text style={styles.petBadgeText}>🐾 {story.pet_name}</Text>
        </View>

        {/* Title */}
        {story.title ? (
          <Text style={styles.title}>{story.title}</Text>
        ) : null}

        {/* Meta: author + date */}
        <View style={styles.metaRow}>
          {authorName ? (
            <Text style={styles.metaText}>Por {authorName}</Text>
          ) : null}
          <Text style={styles.metaDate}>
            {new Date(story.created_at).toLocaleDateString('es-UY', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Text>
        </View>

        {/* Body */}
        <Text style={styles.body}>{story.body}</Text>

        {/* Like button */}
        <TouchableOpacity
          style={[styles.likeButton, likeStory.isPending && styles.likeButtonDisabled]}
          onPress={handleLike}
          disabled={likeStory.isPending}
          activeOpacity={0.7}
        >
          <Text style={styles.likeButtonText}>
            ❤️ {story.like_count} {story.like_count === 1 ? 'me gusta' : 'me gusta'}
          </Text>
        </TouchableOpacity>

        {!isAuthenticated && (
          <Text style={styles.loginHint}>
            Iniciá sesión para dejar un "me gusta"
          </Text>
        )}
      </View>

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
  errorIcon: { fontSize: 48, marginBottom: SPACING.sm },
  errorTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  errorText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  backButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
  },
  backButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.sm },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  backChevron: {
    fontSize: 28,
    color: COLORS.primary,
    lineHeight: 30,
    marginRight: 4,
  },
  backLabel: {
    fontSize: FONTS.sizes.md,
    color: COLORS.primary,
    fontWeight: '600',
  },
  content: {
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  petBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary + '1A',
    borderRadius: RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: SPACING.md,
  },
  petBadgeText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: '700',
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
    lineHeight: 28,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  metaText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  metaDate: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
  },
  body: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    lineHeight: 24,
    marginBottom: SPACING.lg,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  likeButtonDisabled: {
    opacity: 0.6,
  },
  likeButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  loginHint: {
    textAlign: 'center',
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
});
