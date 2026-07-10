// ============================================================
// SearchPet - Home Screen (Feed + Filtros avanzados)
// ============================================================

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useSearchPets, useStories, useImageClassify, useImageSearchNative } from '../../../shared/hooks';
import { useLocationStore, useAuthStore } from '../../store';
import { PetCard } from '../../components/PetCard';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS, MAP_DEFAULTS, PET_TYPES } from '../../constants';
import type { PetType, SuccessStory, ClassifyResult, ImageSearchResult } from '../../../shared/types';
import { ApiError } from '../../../shared/api/client';

const RADII = [5, 10, 25, 50] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation(['home', 'common', 'pets']);
  const { isAuthenticated, user } = useAuthStore();
  const { latitude, longitude, setLocation } = useLocationStore();

  // ── Nudge de verificación (session-only, no persiste) ────
  const [verifyDismissed, setVerifyDismissed] = useState(false);

  // ── Filtros (draft state — updated on every keystroke/tap) ──
  const [draftType, setDraftType] = useState<PetType | undefined>();
  const [draftColor, setDraftColor] = useState('');
  const [draftBreed, setDraftBreed] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  // Filtro de distancia OPCIONAL (como en web): undefined = feed global sin radio
  const [radius, setRadius] = useState<5 | 10 | 25 | 50 | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  // ── Applied state — drives the actual API calls ──────────
  const [appliedType, setAppliedType] = useState<PetType | undefined>();
  const [appliedColor, setAppliedColor] = useState('');
  const [appliedBreed, setAppliedBreed] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const hasActiveFilters = !!appliedType || appliedColor.trim().length > 0
    || appliedBreed.trim().length > 0 || !!appliedFrom || !!appliedTo || !!radius;

  // ── Búsqueda por foto ──
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [photoNoMatch, setPhotoNoMatch] = useState(false);
  const { classify, isModelLoading, isClassifying } = useImageClassify();
  const imageSearchMutation = useImageSearchNative();

  // Server-side image search results (CLIP similarity) — only populated when
  // the user is authenticated and the backend call succeeds.
  const [imageResults, setImageResults] = useState<ImageSearchResult[] | null>(null);

  // ── Ubicación ────────────────────────────────────────────
  const lat = latitude || MAP_DEFAULTS.defaultLatitude;
  const lng = longitude || MAP_DEFAULTS.defaultLongitude;

  useEffect(() => { requestLocation(); }, []);

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation(loc.coords.latitude, loc.coords.longitude);
      }
    } catch {}
  };

  // ── Datos ────────────────────────────────────────────────
  // Feed único unificado (como en web): /pets/search (lost+stray por defecto,
  // orden por recencia). El filtro de distancia es opcional y se suma encima:
  // centro = GPS del usuario, fallback Montevideo (MAP_DEFAULTS).
  const searchQuery = useSearchPets({
    type: appliedType,
    color: appliedColor.trim() || undefined,
    breed: appliedBreed.trim() || undefined,
    from: appliedFrom ? new Date(appliedFrom).toISOString() : undefined,
    to: appliedTo ? new Date(appliedTo).toISOString() : undefined,
    lat: radius ? lat : undefined,
    lng: radius ? lng : undefined,
    radiusMeters: radius ? radius * 1000 : undefined,
  });

  const isLoading = searchQuery.isLoading;
  const isRefetching = searchQuery.isRefetching;

  const handleRefetch = () => { searchQuery.refetch(); };

  const handlePetPress = (petId: string) => router.push(`/pet/${petId}`);

  const applyFilters = () => {
    // A new filter search replaces any active photo-search results
    setImageResults(null);
    setAppliedType(draftType);
    setAppliedColor(draftColor);
    setAppliedBreed(draftBreed);
    setAppliedFrom(draftFrom);
    setAppliedTo(draftTo);
  };

  const clearFilters = () => {
    setDraftType(undefined);
    setDraftColor('');
    setDraftBreed('');
    setDraftFrom('');
    setDraftTo('');
    setAppliedType(undefined);
    setAppliedColor('');
    setAppliedBreed('');
    setAppliedFrom('');
    setAppliedTo('');
    setRadius(undefined);
    setClassifyResult(null);
    setPhotoNoMatch(false);
    setImageResults(null);
  };

  const clearImageResults = () => setImageResults(null);

  const classifyPhoto = async (uri: string) => {
    const result = await classify(uri);
    if (result) {
      setClassifyResult(result);
      if (result.type) {
        setDraftType(result.type);
        setAppliedType(result.type);
      }
      if (result.breed) {
        setDraftBreed(result.breed);
        setAppliedBreed(result.breed);
      }
    } else {
      setPhotoNoMatch(true);
    }
  };

  const pickAndClassify = async (useCamera: boolean) => {
    const picked = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (picked.canceled) return;
    const uri = picked.assets[0].uri;
    setPhotoNoMatch(false);

    if (isAuthenticated) {
      try {
        const response = await imageSearchMutation.mutateAsync(uri);
        setImageResults(response.results);
        setClassifyResult(null);
        return;
      } catch (err) {
        // image_search_unavailable (503) falls back silently — any other error
        // (network, 4xx) also falls back to the local classifier without blocking the user.
        if (!(err instanceof ApiError && err.code === 'image_search_unavailable')) {
          Alert.alert(i18next.t('common:error'), i18next.t('home:photoSearchError'));
        }
      }
    }

    await classifyPhoto(uri);
  };

  const handleImageSearch = () => {
    Alert.alert(i18next.t('home:searchByPhoto'), i18next.t('home:pickOption'), [
      { text: i18next.t('home:camera'), onPress: () => pickAndClassify(true) },
      { text: i18next.t('home:gallery'), onPress: () => pickAndClassify(false) },
      { text: i18next.t('common:cancel'), style: 'cancel' },
    ]);
  };

  // ── Render items ─────────────────────────────────────────
  // Modo foto → ImageSearchResult[]; feed/búsqueda → Pet[]
  const isImageResultsMode = !!imageResults;

  const renderImageResult = ({ item }: { item: ImageSearchResult }) => (
    <TouchableOpacity style={styles.imageResultRow} onPress={() => handlePetPress(item.pet_id)} activeOpacity={0.7}>
      {item.photo_url ? (
        <Image source={{ uri: item.photo_url }} style={styles.imageResultPhoto} />
      ) : (
        <View style={[styles.imageResultPhoto, styles.imageResultPhotoPlaceholder]}>
          <Text style={{ fontSize: 24 }}>🐾</Text>
        </View>
      )}
      <View style={styles.imageResultInfo}>
        <Text style={styles.imageResultName} numberOfLines={1}>{item.name}</Text>
        {item.type && <Text style={styles.imageResultType}>{item.type}</Text>}
      </View>
      <Text style={styles.imageResultSimilarity}>
        {t('pets:card.similarityMatch', { percent: Math.round(item.similarity * 100) })}
      </Text>
    </TouchableOpacity>
  );

  const renderItem = ({ item }: { item: any }) => (
    <PetCard
      pet={item}
      onPress={() => handlePetPress(item.id)}
    />
  );

  const data: any[] = isImageResultsMode
    ? (imageResults ?? [])
    : (searchQuery.data?.data ?? []);

  const resultCount = isImageResultsMode
    ? data.length
    : (searchQuery.data?.total ?? data.length);

  // ── Historias de éxito ───────────────────────────────────
  const storiesQuery = useStories({ limit: 10 });
  const stories: SuccessStory[] = storiesQuery.data ?? [];

  const renderStoryCard = ({ item }: { item: SuccessStory }) => {
    const displayText =
      item.title ||
      (item.body.length > 80 ? item.body.slice(0, 80) + '…' : item.body);

    return (
      <TouchableOpacity
        style={styles.storyCard}
        onPress={() => router.push(`/story/${item.id}` as any)}
        activeOpacity={0.7}
      >
        <Text style={styles.storyPetName}>{item.pet_name}</Text>
        <Text style={styles.storyBody} numberOfLines={2}>{displayText}</Text>
        <Text style={styles.storyLikes}>❤️ {item.like_count}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* ── Barra de filtros ── */}
      <View style={styles.filterBar}>
        {/* Chips de tipo */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {/* Chip "Todos" */}
          <TouchableOpacity
            style={[styles.chip, !draftType && styles.chipActive]}
            onPress={() => { setDraftType(undefined); setAppliedType(undefined); }}
          >
            <Text style={[styles.chipText, !draftType && styles.chipTextActive]}>
              🐾 {t('home:all')}
            </Text>
          </TouchableOpacity>

          {PET_TYPES.map((petType) => (
            <TouchableOpacity
              key={petType.value}
              style={[styles.chip, draftType === petType.value && styles.chipActive]}
              onPress={() => {
                const next = draftType === petType.value ? undefined : petType.value as PetType;
                setDraftType(next);
                setAppliedType(next);
              }}
            >
              <Text style={[styles.chipText, draftType === petType.value && styles.chipTextActive]}>
                {petType.icon} {t(`pets:types.${petType.value}`)}
              </Text>
            </TouchableOpacity>
          ))}

          {/* Toggle más filtros */}
          <TouchableOpacity
            style={[styles.chip, showFilters && styles.chipActive]}
            onPress={() => setShowFilters(!showFilters)}
          >
            <Text style={[styles.chipText, showFilters && styles.chipTextActive]}>
              ⚙️ {t('home:more')}
            </Text>
          </TouchableOpacity>

          {/* Buscar por foto */}
          <TouchableOpacity
            style={[styles.chip, (isModelLoading || isClassifying || imageSearchMutation.isPending) && styles.chipDisabled]}
            onPress={handleImageSearch}
            disabled={isModelLoading || isClassifying || imageSearchMutation.isPending}
          >
            <Text style={styles.chipText}>
              {imageSearchMutation.isPending || isClassifying
                ? `🔍 ${t('home:analyzing')}`
                : isModelLoading
                ? `⏳ ${t('home:loadingModel')}`
                : `📷 ${t('home:byPhoto')}`}
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Chip de resultado de clasificación */}
        {classifyResult?.type && (
          <View style={styles.classifyResultRow}>
            <Text style={styles.classifyResultText}>
              {classifyResult.breed ?? classifyResult.type} · {Math.round(classifyResult.confidence * 100)}%
            </Text>
            <TouchableOpacity onPress={clearFilters}>
              <Text style={styles.classifyResultClear}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Sin coincidencia */}
        {photoNoMatch && (
          <View style={styles.noMatchRow}>
            <Text style={styles.noMatchText}>{t('home:noMatchText')}</Text>
            <TouchableOpacity onPress={() => setPhotoNoMatch(false)}>
              <Text style={styles.classifyResultClear}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Filtros extra: color + radio */}
        {showFilters && (
          <View style={styles.extraFilters}>
            <TextInput
              style={styles.colorInput}
              placeholder={t('home:colorPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              value={draftColor}
              onChangeText={setDraftColor}
              returnKeyType="search"
            />

            <TextInput
              style={styles.colorInput}
              placeholder={t('home:breedPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              value={draftBreed}
              onChangeText={setDraftBreed}
              returnKeyType="search"
            />

            <TextInput
              style={styles.colorInput}
              placeholder={t('home:fromPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              value={draftFrom}
              onChangeText={setDraftFrom}
              returnKeyType="next"
            />

            <TextInput
              style={styles.colorInput}
              placeholder={t('home:toPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              value={draftTo}
              onChangeText={setDraftTo}
              returnKeyType="search"
            />

            {/* Apply filters button — triggers the API call */}
            <TouchableOpacity style={styles.applyButton} onPress={applyFilters}>
              <Text style={styles.applyButtonText}>{t('common:search')}</Text>
            </TouchableOpacity>

            {/* Filtro de distancia opcional — tap en el chip activo lo deselecciona */}
            <View style={styles.radiusRow}>
              <Text style={styles.radiusLabel}>{t('home:distanceLabel')}</Text>
              {RADII.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.radiusChip, radius === r && styles.radiusChipActive]}
                  onPress={() => setRadius(radius === r ? undefined : r)}
                >
                  <Text style={[styles.radiusChipText, radius === r && styles.radiusChipTextActive]}>
                    {r} km
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* ── Header info ── */}
      <View style={styles.header}>
        {isImageResultsMode ? (
          <View style={styles.headerRow}>
            <Text style={styles.greeting}>
              {t('home:photoResultsTitle')} ({resultCount})
            </Text>
            <TouchableOpacity onPress={clearImageResults}>
              <Text style={styles.clearText}>{t('home:clearPhotoResults')}</Text>
            </TouchableOpacity>
          </View>
        ) : hasActiveFilters ? (
          <View style={styles.headerRow}>
            <Text style={styles.greeting}>
              {t('home:results', { count: resultCount })}
            </Text>
            <TouchableOpacity onPress={clearFilters}>
              <Text style={styles.clearText}>{t('home:clearFilters')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.greeting}>{t('home:feedTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('home:feedCount', { count: resultCount })}
            </Text>
          </>
        )}
      </View>

      {/* ── CTA para no autenticados ── */}
      {!isAuthenticated && !hasActiveFilters && (
        <TouchableOpacity
          style={styles.ctaBanner}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.ctaText}>{t('home:loginCta')}</Text>
          <Text style={styles.ctaArrow}>→</Text>
        </TouchableOpacity>
      )}

      {/* ── Nudge de verificación de teléfono ── */}
      {isAuthenticated && user && !user.phone_verified && !user.email_verified && !verifyDismissed && (
        <View style={styles.verifyNudge}>
          <Text style={styles.verifyNudgeText}>{t('home:verifyNudge')}</Text>
          <View style={styles.verifyNudgeActions}>
            <TouchableOpacity
              style={styles.verifyNudgeBtn}
              onPress={() => router.push('/verify-phone')}
            >
              <Text style={styles.verifyNudgeBtnText}>{t('home:verifyNudgeCta')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setVerifyDismissed(true)}>
              <Text style={styles.verifyNudgeDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Historias de éxito ── */}
      {storiesQuery.isLoading && (
        <View style={styles.storiesLoadingRow}>
          <ActivityIndicator size="small" color={COLORS.primary} />
        </View>
      )}
      {!storiesQuery.isLoading && stories.length > 0 && (
        <View style={styles.storiesSection}>
          <Text style={styles.storiesSectionTitle}>{t('home:successStories')}</Text>
          <FlatList
            data={stories}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            renderItem={renderStoryCard}
            contentContainerStyle={styles.storiesList}
          />
        </View>
      )}

      {/* ── Lista ── */}
      {!isImageResultsMode && isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>
            {hasActiveFilters ? t('home:searching') : t('home:loading')}
          </Text>
        </View>
      ) : isImageResultsMode ? (
        <FlatList
          data={data}
          keyExtractor={(item: ImageSearchResult) => item.pet_id}
          renderItem={renderImageResult}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>{t('home:photoNoResults')}</Text>
              <TouchableOpacity style={styles.clearButton} onPress={clearImageResults}>
                <Text style={styles.clearButtonText}>{t('home:clearPhotoResults')}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefetch}
              tintColor={COLORS.primary}
            />
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🐾</Text>
              <Text style={styles.emptyTitle}>
                {hasActiveFilters ? t('home:noResultsTitle') : t('home:emptyFeedTitle')}
              </Text>
              <Text style={styles.emptyText}>
                {hasActiveFilters ? t('home:noResultsText') : t('home:emptyFeedText')}
              </Text>
              {hasActiveFilters && (
                <TouchableOpacity style={styles.clearButton} onPress={clearFilters}>
                  <Text style={styles.clearButtonText}>{t('home:clearFiltersButton')}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: SPACING.md, fontSize: FONTS.sizes.md, color: COLORS.textSecondary },

  // ── Filtros ──
  filterBar: {
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingTop: SPACING.sm,
  },
  chipsRow: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  extraFilters: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  colorInput: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  radiusLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  radiusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  radiusChipActive: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  radiusChipText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  radiusChipTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },

  // ── Header ──
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4 },
  clearText: { fontSize: FONTS.sizes.sm, color: COLORS.primary, fontWeight: '600' },

  // ── CTA ──
  ctaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.primary,
    marginHorizontal: SPACING.lg,
    marginVertical: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: 12,
  },
  ctaText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '600', flex: 1 },
  ctaArrow: { color: COLORS.white, fontSize: FONTS.sizes.xl, fontWeight: '700', marginLeft: SPACING.sm },

  // ── Nudge de verificación ──
  verifyNudge: {
    flexDirection: 'column',
    backgroundColor: COLORS.secondary,
    marginHorizontal: SPACING.lg,
    marginVertical: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: 12,
  },
  verifyNudgeText: { color: COLORS.white, fontSize: FONTS.sizes.sm, fontWeight: '500', marginBottom: SPACING.xs },
  verifyNudgeActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verifyNudgeBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    backgroundColor: COLORS.white,
    borderRadius: 8,
  },
  verifyNudgeBtnText: { color: COLORS.secondary, fontWeight: '700', fontSize: FONTS.sizes.sm },
  verifyNudgeDismiss: { color: COLORS.white, fontSize: FONTS.sizes.lg, fontWeight: '700', paddingHorizontal: SPACING.sm },

  // ── Lista ──
  list: { paddingHorizontal: SPACING.lg, paddingBottom: 100 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: SPACING.xxl * 2 },
  emptyIcon: { fontSize: 60, marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.sizes.lg, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', paddingHorizontal: SPACING.xl },
  clearButton: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  clearButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.sm },

  // ── Apply filters button ──
  applyButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  applyButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.sm },

  // ── Historias de éxito ──
  storiesLoadingRow: {
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  storiesSection: {
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  storiesSectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  storiesList: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
  },
  storyCard: {
    width: 180,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  storyPetName: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  storyBody: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: SPACING.sm,
    flex: 1,
  },
  storyLikes: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    fontWeight: '500',
  },

  // ── Buscar por foto ──
  chipDisabled: {
    opacity: 0.5,
  },
  classifyResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    backgroundColor: COLORS.primary + '1A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
  },
  classifyResultText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.primary,
  },
  classifyResultClear: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: '700',
  },
  noMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    backgroundColor: '#FFF3CD',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFEAA7',
  },
  noMatchText: {
    fontSize: FONTS.sizes.sm,
    color: '#856404',
    flex: 1,
  },

  // ── Resultados de búsqueda por foto (server-side image search) ──
  imageResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.md,
    padding: SPACING.sm,
    ...SHADOWS.md,
  },
  imageResultPhoto: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.sm,
  },
  imageResultPhotoPlaceholder: {
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageResultInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  imageResultName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  imageResultType: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  imageResultSimilarity: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: COLORS.primary,
    marginLeft: SPACING.sm,
  },
});
