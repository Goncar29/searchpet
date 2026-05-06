// ============================================================
// SearchPet - Map Screen (Mapa interactivo con reportes)
// ============================================================

import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import MapView, { Marker, Callout, PROVIDER_DEFAULT } from 'react-native-maps';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useNearbyReports } from '../../../shared/hooks';
import { useLocationStore } from '../../store';
import { COLORS, SPACING, FONTS, MAP_DEFAULTS } from '../../constants';
import type { Report } from '../../../shared/types';

const { width, height } = Dimensions.get('window');

export default function MapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const { latitude, longitude, setLocation } = useLocationStore();
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  const lat = latitude || MAP_DEFAULTS.defaultLatitude;
  const lng = longitude || MAP_DEFAULTS.defaultLongitude;

  const { data: reports, isLoading } = useNearbyReports(lat, lng, 15, true);

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

  const getMarkerColor = (status: string) => {
    switch (status) {
      case 'lost': return COLORS.lost;
      case 'found': return COLORS.found;
      case 'sighting': return COLORS.sighting;
      default: return COLORS.primary;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'lost': return 'PERDIDO';
      case 'found': return 'ENCONTRADO';
      case 'sighting': return 'AVISTAMIENTO';
      default: return status.toUpperCase();
    }
  };

  const centerOnUser = () => {
    if (latitude && longitude && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Cargando mapa...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: lat,
          longitude: lng,
          latitudeDelta: MAP_DEFAULTS.latitudeDelta,
          longitudeDelta: MAP_DEFAULTS.longitudeDelta,
        }}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {reports?.map((report) => (
          <Marker
            key={report.id}
            coordinate={{
              latitude: report.latitude,
              longitude: report.longitude,
            }}
            pinColor={getMarkerColor(report.status)}
            onPress={() => setSelectedReport(report)}
          >
            <Callout
              onPress={() => router.push(`/pet/${report.pet?.id || report.pet_id}`)}
            >
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>
                  {report.pet?.name || 'Mascota'}
                </Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: getMarkerColor(report.status) },
                  ]}
                >
                  <Text style={styles.statusText}>
                    {getStatusLabel(report.status)}
                  </Text>
                </View>
                {report.location_description && (
                  <Text style={styles.calloutDesc}>
                    {report.location_description}
                  </Text>
                )}
                <Text style={styles.calloutAction}>Toca para ver detalles</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Botón centrar en usuario */}
      <TouchableOpacity style={styles.centerButton} onPress={centerOnUser}>
        <Text style={styles.centerIcon}>📍</Text>
      </TouchableOpacity>

      {/* Leyenda */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COLORS.lost }]} />
          <Text style={styles.legendText}>Perdido</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COLORS.found }]} />
          <Text style={styles.legendText}>Encontrado</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COLORS.sighting }]} />
          <Text style={styles.legendText}>Avistado</Text>
        </View>
      </View>

      {/* Contador */}
      <View style={styles.counter}>
        <Text style={styles.counterText}>
          {reports?.length || 0} reportes en la zona
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  map: {
    width,
    height: height,
  },
  callout: {
    width: 200,
    padding: SPACING.sm,
  },
  calloutTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 6,
  },
  statusText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
  },
  calloutDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  calloutAction: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.primary,
    fontWeight: '600',
  },
  centerButton: {
    position: 'absolute',
    bottom: 180,
    right: SPACING.lg,
    backgroundColor: COLORS.white,
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  centerIcon: { fontSize: 22 },
  legend: {
    position: 'absolute',
    top: SPACING.lg,
    left: SPACING.lg,
    right: SPACING.lg,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  legendText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  counter: {
    position: 'absolute',
    bottom: 120,
    left: SPACING.lg,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: 20,
  },
  counterText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xs,
    fontWeight: '600',
  },
});
