// ============================================================
// SearchPet - Home Screen (Feed de mascotas perdidas)
// ============================================================

import { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useNearbyReports } from '../../../shared/hooks';
import { useLocationStore, useAuthStore } from '../../store';
import { PetCard } from '../../components/PetCard';
import { COLORS, SPACING, FONTS, MAP_DEFAULTS } from '../../constants';

export default function HomeScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { latitude, longitude, setLocation } = useLocationStore();

  const lat = latitude || MAP_DEFAULTS.defaultLatitude;
  const lng = longitude || MAP_DEFAULTS.defaultLongitude;

  const {
    data: reports,
    isLoading,
    refetch,
    isRefetching,
  } = useNearbyReports(lat, lng, 10, true);

  useEffect(() => {
    requestLocation();
  }, []);

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        setLocation(location.coords.latitude, location.coords.longitude);
      }
    } catch (error) {
      console.log('Error getting location:', error);
    }
  };

  const handlePetPress = (petId: string) => {
    router.push(`/pet/${petId}`);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Buscando mascotas cerca de ti...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header Info */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {isAuthenticated ? 'Mascotas cerca de ti' : 'Mascotas perdidas'}
        </Text>
        <Text style={styles.subtitle}>
          {reports?.length || 0} reportes activos en tu zona
        </Text>
      </View>

      {/* Quick Actions */}
      {!isAuthenticated && (
        <TouchableOpacity
          style={styles.ctaBanner}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.ctaText}>
            Inicia sesión para publicar y ayudar
          </Text>
          <Text style={styles.ctaArrow}>→</Text>
        </TouchableOpacity>
      )}

      {/* Feed de reportes */}
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PetCard
            report={item}
            onPress={() => handlePetPress(item.pet?.id || item.pet_id)}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={COLORS.primary}
          />
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🐾</Text>
            <Text style={styles.emptyTitle}>No hay reportes cercanos</Text>
            <Text style={styles.emptyText}>
              No se encontraron mascotas perdidas en tu zona.
              Eso es bueno!
            </Text>
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
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  greeting: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
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
  ctaText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    flex: 1,
  },
  ctaArrow: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    marginLeft: SPACING.sm,
  },
  list: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: 100,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xxl * 2,
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: SPACING.md,
  },
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
    paddingHorizontal: SPACING.xl,
  },
});
