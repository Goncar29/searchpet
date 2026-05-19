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
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useNearbyReports, useSearchPets } from '../../../shared/hooks';
import { useLocationStore, useAuthStore } from '../../store';
import { PetCard } from '../../components/PetCard';
import { COLORS, SPACING, FONTS, MAP_DEFAULTS, PET_TYPES } from '../../constants';
import type { PetType } from '../../../shared/types';

const RADII = [5, 10, 25, 50] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { latitude, longitude, setLocation } = useLocationStore();

  // ── Filtros ──────────────────────────────────────────────
  const [filterType, setFilterType] = useState<PetType | undefined>();
  const [filterColor, setFilterColor] = useState('');
  const [radius, setRadius] = useState<5 | 10 | 25 | 50>(10);
  const [showFilters, setShowFilters] = useState(false);

  const isSearchMode = !!filterType || filterColor.trim().length > 0;

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
  });

  const isLoading = isSearchMode ? searchQuery.isLoading : nearbyQuery.isLoading;
  const isRefetching = isSearchMode ? false : nearbyQuery.isRefetching;

  const handleRefetch = () => { if (!isSearchMode) nearbyQuery.refetch(); };

  const handlePetPress = (petId: string) => router.push(`/pet/${petId}`);

  const clearFilters = () => {
    setFilterType(undefined);
    setFilterColor('');
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
              🐾 Todos
            </Text>
          </TouchableOpacity>

          {PET_TYPES.map((t) => (
            <TouchableOpacity
              key={t.value}
              style={[styles.chip, filterType === t.value && styles.chipActive]}
              onPress={() => setFilterType(filterType === t.value ? undefined : t.value as PetType)}
            >
              <Text style={[styles.chipText, filterType === t.value && styles.chipTextActive]}>
                {t.icon} {t.label}
              </Text>
            </TouchableOpacity>
          ))}

          {/* Toggle más filtros */}
          <TouchableOpacity
            style={[styles.chip, showFilters && styles.chipActive]}
            onPress={() => setShowFilters(!showFilters)}
          >
            <Text style={[styles.chipText, showFilters && styles.chipTextActive]}>
              ⚙️ Más
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Filtros extra: color + radio */}
        {showFilters && (
          <View style={styles.extraFilters}>
            <TextInput
              style={styles.colorInput}
              placeholder="Color (ej: negro, blanco...)"
              placeholderTextColor={COLORS.textMuted}
              value={filterColor}
              onChangeText={setFilterColor}
              returnKeyType="search"
            />

            {/* Radio (solo en modo nearby) */}
            {!isSearchMode && (
              <View style={styles.radiusRow}>
                <Text style={styles.radiusLabel}>Radio:</Text>
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
              {resultCount} resultado{resultCount !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity onPress={clearFilters}>
              <Text style={styles.clearText}>Limpiar filtros ✕</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.greeting}>
              {isAuthenticated ? 'Mascotas cerca de ti' : 'Mascotas perdidas'}
            </Text>
            <Text style={styles.subtitle}>
              {data.length} reportes activos · radio {radius} km
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
          <Text style={styles.ctaText}>Iniciá sesión para publicar y ayudar</Text>
          <Text style={styles.ctaArrow}>→</Text>
        </TouchableOpacity>
      )}

      {/* ── Lista ── */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>
            {isSearchMode ? 'Buscando...' : 'Buscando mascotas cerca de ti...'}
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
                {isSearchMode ? 'Sin resultados' : 'No hay reportes cercanos'}
              </Text>
              <Text style={styles.emptyText}>
                {isSearchMode
                  ? 'Probá con otros filtros o amplíalos'
                  : 'No se encontraron mascotas perdidas en tu zona. ¡Eso es bueno!'}
              </Text>
              {isSearchMode && (
                <TouchableOpacity style={styles.clearButton} onPress={clearFilters}>
                  <Text style={styles.clearButtonText}>Limpiar filtros</Text>
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
});
