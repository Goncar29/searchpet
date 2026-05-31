// ============================================================
// SearchPet - Map Screen (MapLibre — OpenStreetMap, gratuito)
// ============================================================

import { useEffect, useState, useRef, Component, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useNearbyReports } from '../../../shared/hooks';
import { useLocationStore } from '../../store';
import { COLORS, SPACING, FONTS, MAP_DEFAULTS } from '../../constants';
import type { Report } from '../../../shared/types';

// MapLibre no necesita token de Mapbox
MapLibreGL.setAccessToken(null);

// EXPO_PUBLIC_* es reemplazado por Metro en build time
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY || '';
const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://demotiles.maplibre.org/style.json';

// ============================================================
// Error Boundary — evita que un crash del mapa cierre la app
// ============================================================

class MapErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>🗺️</Text>
          <Text style={styles.errorText}>
            El mapa no está disponible en este momento.{'\n'}
            Verificá tu conexión o los permisos de la app.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// Screen
// ============================================================

export default function MapScreen() {
  const router = useRouter();
  const cameraRef = useRef<MapLibreGL.Camera>(null);
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
    } catch {
      // silencioso — el mapa igual carga con la ubicación default
    }
  };

  const getMarkerColor = (status: string) => {
    switch (status) {
      case 'lost':     return COLORS.lost;
      case 'found':    return COLORS.found;
      case 'sighting': return COLORS.sighting;
      default:         return COLORS.primary;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'lost':     return 'PERDIDO';
      case 'found':    return 'ENCONTRADO';
      case 'sighting': return 'AVISTAMIENTO';
      default:         return status.toUpperCase();
    }
  };

  const centerOnUser = () => {
    if (latitude && longitude) {
      // MapLibre: [longitude, latitude] — orden invertido vs react-native-maps
      cameraRef.current?.setCamera({
        centerCoordinate: [longitude, latitude],
        zoomLevel: 14,
        animationDuration: 300,
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
    <MapErrorBoundary>
      <View style={styles.container}>
        <MapLibreGL.MapView
          style={styles.map}
          styleURL={MAP_STYLE}
          onPress={() => setSelectedReport(null)}
        >
          <MapLibreGL.Camera
            ref={cameraRef}
            zoomLevel={12}
            centerCoordinate={[lng, lat]}
          />

          <MapLibreGL.UserLocation visible />

          {reports?.map((report) => (
            <MapLibreGL.PointAnnotation
              key={report.id}
              id={`marker-${report.id}`}
              // MapLibre: [longitude, latitude]
              coordinate={[report.longitude, report.latitude]}
              onSelected={() => setSelectedReport(report)}
            >
              <View
                style={[
                  styles.marker,
                  { backgroundColor: getMarkerColor(report.status) },
                ]}
              />
            </MapLibreGL.PointAnnotation>
          ))}
        </MapLibreGL.MapView>

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

        {/* Card del reporte seleccionado — mejor UX que callout popup */}
        {selectedReport && (
          <TouchableOpacity
            style={styles.reportCard}
            onPress={() =>
              router.push(`/pet/${selectedReport.pet?.id || selectedReport.pet_id}`)
            }
            activeOpacity={0.85}
          >
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: getMarkerColor(selectedReport.status) },
              ]}
            >
              <Text style={styles.statusText}>
                {getStatusLabel(selectedReport.status)}
              </Text>
            </View>
            <Text style={styles.reportName}>
              {selectedReport.pet?.name || 'Mascota'}
            </Text>
            {selectedReport.location_description && (
              <Text style={styles.reportDesc}>
                {selectedReport.location_description}
              </Text>
            )}
            <Text style={styles.reportAction}>Toca para ver detalles →</Text>
          </TouchableOpacity>
        )}
      </View>
    </MapErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  errorIcon: { fontSize: 48, marginBottom: SPACING.md },
  errorText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  marker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.white,
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
  legendItem: { flexDirection: 'row', alignItems: 'center' },
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
  reportCard: {
    position: 'absolute',
    bottom: 140,
    left: SPACING.lg,
    right: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 6,
  },
  statusText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  reportName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  reportDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  reportAction: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: '600',
  },
});
