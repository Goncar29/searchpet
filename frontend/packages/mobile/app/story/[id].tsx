// ============================================================
// SearchPet - Story Detail Screen
// ============================================================

import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStory, useLikeStory, useUnlikeStory } from '../../../shared/hooks';
import { ApiError } from '../../../shared/api/client';
import { StaleDataNotice } from '../../components/list/ListState';
import { getDateLocale } from '../../i18n/dateLocale';
import { useAuthStore } from '../../store';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

export default function StoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation('story');
  const { isAuthenticated } = useAuthStore();
  const storyQuery = useStory(id ?? '');
  const { data: story, isLoading, isError, error, refetch } = storyQuery;

  // `isError` NO alcanza para saber si la historia existe: `apiClient` tira
  // `ApiError` ante CUALQUIER respuesta no-ok (`client.ts`), así que una
  // historia borrada llega acá como error igual que un 502. Sin mirar el
  // status, el cartel le diría "no es que no exista, no llegamos a leerla"
  // justamente cuando NO existe — y ofrecería reintentar tres veces
  // (`retry: 2`) contra un 404 que nunca va a cambiar.
  const noExiste = error instanceof ApiError && error.status === 404;
  const falloLaLectura = isError && !noExiste;
  const likeStory = useLikeStory();
  const unlikeStory = useUnlikeStory();
  const isToggling = likeStory.isPending || unlikeStory.isPending;

  const handleLike = () => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!story?.id) return;
    if (story.liked_by_me) {
      unlikeStory.mutate(story.id);
    } else {
      likeStory.mutate(story.id);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>{t('story:loadingDetail')}</Text>
      </View>
    );
  }

  // `!story` y NO `isError || !story`: React Query conserva lo cacheado cuando
  // falla un refetch, así que con el `||` un fallo pasajero reemplazaba la
  // historia que el usuario estaba leyendo por "no encontrada" — que además es
  // FALSO: la historia existe, sólo no pudimos releerla.
  if (!story) {
    // Y ADEMÁS distingue las dos causas, que antes se pintaban igual: sin
    // historia y con error decía "no encontrada", una afirmación sobre el mundo
    // que no podemos hacer si no llegamos a leerlo. El caso de error ofrece
    // reintentar; el de verdad-no-existe, volver.
    //
    // Las claves `story:loadError` y `story:retry` ya existían en los tres
    // idiomas: las usaba el listado antes de portarse a `ListState`.
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>{isError ? '⚠️' : '😢'}</Text>
        {/* `fallóLaLectura` y no `isError`: un 404 ES una respuesta, y decirle
            "no llegamos a leerla" a alguien cuya historia fue borrada es
            afirmar lo contrario de lo que pasó.

            Claves propias del DETALLE: `story:loadError` es del listado y dice
            "no se pudieron cargar las historias", en plural. Reusarla acá
            hablaría de un conjunto cuando falló una sola. */}
        <Text style={styles.errorTitle}>
          {falloLaLectura ? t('story:detailLoadError') : t('story:notFound')}
        </Text>
        <Text style={styles.errorText}>
          {falloLaLectura ? t('story:detailLoadErrorText') : t('story:notFoundText')}
        </Text>
        {/* Volver está SIEMPRE, y reintentar se suma sólo cuando reintentar
            puede servir de algo. Antes el botón de reintentar REEMPLAZABA al de
            volver, así que esa rama se quedaba sin salida — y encima ofrecía
            reintentar contra un 404. */}
        {falloLaLectura && (
          <TouchableOpacity style={styles.backButton} onPress={() => refetch()}>
            <Text style={styles.backButtonText}>{t('story:retry')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>{t('story:back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const authorName = story.user_name ?? (story as Record<string, unknown>).hero_name as string | undefined;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Un like/unlike invalida esta query, así que un refetch fallido es
          alcanzable aunque la pantalla no tenga pull-to-refresh. */}
      <StaleDataNotice query={storyQuery} />

      {/* Back navigation */}
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
        <Text style={styles.backChevron}>‹</Text>
        <Text style={styles.backLabel}>{t('story:title')}</Text>
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
            <Text style={styles.metaText}>{t('story:by', { name: authorName })}</Text>
          ) : null}
          <Text style={styles.metaDate}>
            {new Date(story.created_at).toLocaleDateString(getDateLocale(i18n.language), {
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
          testID="story-like-button"
          style={[styles.likeButton, isToggling && styles.likeButtonDisabled]}
          onPress={handleLike}
          disabled={isToggling}
          activeOpacity={0.7}
        >
          <Text style={styles.likeButtonText}>
            {story.liked_by_me ? '❤️' : '🤍'} {t('story:likes', { count: story.like_count })}
          </Text>
        </TouchableOpacity>

        {!isAuthenticated && (
          <Text style={styles.loginHint}>{t('story:loginHint')}</Text>
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
