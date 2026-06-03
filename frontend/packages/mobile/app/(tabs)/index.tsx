// ============================================================
// SearchPet - Home Screen (Feed + Filtros avanzados)
// ============================================================

import { useEffect, useState } from 'react';
import {
  View,
  Text,
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
import { useNearbyReports, useSearchPets, useStories, useImageClassify } from '../../../shared/hooks';
import { useLocationStore, useAuthStore } from '../../store';
import { PetCard } from '../../components/PetCard';
import { COLORS, SPACING, FONTS, MAP_DEFAULTS, PET_TYPES } from '../../constants';
import type { PetType, SuccessStory, ClassifyResult } from '../../../shared/types';

const RADII = [5, 10, 25, 50] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation(['home', 'common']);
  const { isAuthenticated } = useAuthStore();
  const { latitude, longitude, setLocation } = useLocationStore();

  // ── Filtros ──────────────────────────────────────────────
  const [filterType, setFilterType] = useState<PetType | undefined>();
  const [filterColor, setFilterColor] = useState('');
  const [filterBreed, setFilterBreed] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [radius, setRadius] = useState<5 | 10 | 25 | 50>(10);
  const [showFilters, setShowFilters] = useState(false);

  const isSearchMode = !!filterType || filterColor.trim().length > 0
    || filterBreed.trim().length > 0 || !!filterFrom || !!filterTo;

  // ── Búsqueda por foto ──
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [photoNoMatch, setPhotoNoMatch] = useState(false);
  const { classify, isModelLoading, isClassifying } = useImageClassify();

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
  const nearbyQuery = useNearbyReports(lat, lng, radius, !isSearchMode);
  const searchQuery = useSearchPets({
    type: filterType,
    color: filterColor.trim() || undefined,
    status: 'active',
    breed: filterBreed.trim() || undefined,
    from: filterFrom ? new Date(filterFrom).toISOString() : undefined,
    to: filterTo ? new Date(filterTo).toISOString() : undefined,
  });

  const isLoading = isSearchMode ? searchQuery.isLoading : nearbyQuery.isLoading;
  const isRefetching = isSearchMode ? false : nearbyQuery.isRefetching;

  const handleRefetch = () => { if (!isSearchMode) nearbyQuery.refetch(); };

  const handlePetPress = (petId: string) => router.push(`/pet/${petId}`);

  const clearFilters = () => {
    setFilterType(undefined);
    setFilterColor('');
    setFilterBreed('');
    setFilterFrom('');
    setFilterTo('');
    setClassifyResult(null);
    setPhotoNoMatch(false);
  };

  const pickAndClassify = async (useCamera: boolean) => {
    const picked = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (picked.canceled) return;
    const uri = picked.assets[0].uri;
    const result = await classify(uri);
    if (result) {
      setClassifyResult(result);
      if (result.type) setFilterType(result.type);
      if (result.breed) setFilterBreed(result.breed);
    } else {
      setPhotoNoMatch(true);
    }
  };

  const handleImageSearch = () => {
    Alert.alert(i18next.t('home:searchByPhoto'), i18next.t('home:pickOption'), [
      { text: i18next.t('home:camera'), onPress: () => pickAndClassify(true) },
      { text: i18next.t('home:gallery'), onPress: () => pickAndClassify(false) },
      { text: i18next.t('common:cancel'), style: 'cancel' },
    ]);
  };

  // ── Render items ─────────────────────────────────────────
  // Modo búsqueda → Pet[]; modo nearby → Report[]
  const renderItem = isSearchMode
    ? ({ item }: { item: any }) => (
        <PetCard
          pet={item}
          onPress={() => handlePetPress(item.id)}
        />
      )
    : ({ item }: { item: any }) => (
        <PetCard
          report={item}
          onPress={() => handlePetPress(item.pet?.id || item.pet_id)}
        />
      );

  const data: any[] = isSearchMode
    ? (searchQuery.data?.data ?? [])
    : (nearbyQuery.data ?? []);

  const resultCount = isSearchMode
    ? (searchQuery.data?.total ?? data.length)
    : data.length;

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
            style={[styles.chip, !filterType && styles.chipActive]}
            onPress={() => setFilterType(undefined)}
          >
            <Text style={[styles.chipText, !filterType && styles.chipTextActive]}>
              🐾 {t('home:all')}
            </Text>
          </TouchableOpacity>

          {PET_TYPES.map((petType) => (
            <TouchableOpacity
              key={petType.value}
              style={[styles.chip, filterType === petType.value && styles.chipActive]}
              onPress={() => setFilterType(filterType === petType.value ? undefined : petType.value as PetType)}
            >
              <Text style={[styles.chipText, filterType === petType.value && styles.chipTextActive]}>
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
            style={[styles.chip, (isModelLoading || isClassifying) && styles.chipDisabled]}
            onPress={handleImageSearch}
            disabled={isModelLoading || isClassifying}
          >
            <Text style={styles.chipText}>
              {isModelLoading ? `⏳ ${t('home:loadingModel')}` : isClassifying ? `🔍 ${t('home:analyzing')}` : `📷 ${t('home:byPhoto')}`}
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
              value={filterColor}
              onChangeText={setFilterColor}
              returnKeyType="search"
            />

            <TextInput
              style={styles.colorInput}
              placeholder={t('home:breedPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              value={filterBreed}
              onChangeText={setFilterBreed}
              returnKeyType="search"
            />

            <TextInput
              style={styles.colorInput}
              placeholder={t('home:fromPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              value={filterFrom}
              onChangeText={setFilterFrom}
              returnKeyType="next"
            />

            <TextInput
              style={styles.colorInput}
              placeholder={t('home:toPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              value={filterTo}
              onChangeText={setFilterTo}
              returnKeyType="search"
            />

            {/* Radio (solo en modo nearby) */}
            {!isSearchMode && (
              <View style={styles.radiusRow}>
                <Text style={styles.radiusLabel}>{t('home:radius')}</Text>
                {RADII.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.radiusChip, radius === r && styles.radiusChipActive]}
                    onPress={() => setRadius(r)}
                  >
                    <Text style={[styles.radiusChipText, radius === r && styles.radiusChipTextActive]}>
                      {r} km
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* ── Header info ── */}
      <View style={styles.header}>
        {isSearchMode ? (
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
            <Text style={styles.greeting}>
              {isAuthenticated ? t('home:nearbyTitle') : t('home:lostTitle')}
            </Text>
            <Text style={styles.subtitle}>
              {t('home:activeReports', { count: data.length, radius })}
            </Text>
          </>
        )}
      </View>

      {/* ── CTA para no autenticados ── */}
      {!isAuthenticated && !isSearchMode && (
        <TouchableOpacity
          style={styles.ctaBanner}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.ctaText}>{t('home:loginCta')}</Text>
          <Text style={styles.ctaArrow}>→</Text>
        </TouchableOpacity>
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
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>
            {isSearchMode ? t('home:searching') : t('home:loading')}
          </Text>
        </View>
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
                {isSearchMode ? t('home:noResultsTitle') : t('home:noNearbyTitle')}
              </Text>
              <Text style={styles.emptyText}>
                {isSearchMode ? t('home:noResultsText') : t('home:noNearbyText')}
              </Text>
              {isSearchMode && (
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
});
