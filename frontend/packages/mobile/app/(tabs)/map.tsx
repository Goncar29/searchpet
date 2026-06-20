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
  Linking,
} from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as Location from 'expo-location';
import { useNearbyReports, useNearbyVets } from '../../../shared/hooks';
import { useLocationStore } from '../../store';
import { COLORS, SPACING, FONTS, MAP_DEFAULTS } from '../../constants';
import type { Report, Vet } from '../../../shared/types';

// MapLibre no necesita token de Mapbox
MapLibreGL.setAccessToken(null);

// Genera un polígono GeoJSON que aproxima un círculo dado un centro y radio en km.
export function createCircleGeoJSON(lng: number, lat: number, radiusKm: number, points = 64) {
  const latRad = (lat * Math.PI) / 180;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusKm / 111.32) * Math.sin(angle);
    const dLng = (radiusKm / (111.32 * Math.cos(latRad))) * Math.cos(angle);
    coords.push([lng + dLng, lat + dLat]);
  }
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [coords] },
    properties: {},
  };
}

// Maptiler streets-v2 — calidad similar a Google Maps, key configurada en app.config.js
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v4/style.json?key=${MAPTILER_KEY}`;

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
            {i18next.t('map:unavailable')}
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
  const { t } = useTranslation('map');
  const cameraRef = useRef<MapLibreGL.Camera>(null);
  const { latitude, longitude, setLocation } = useLocationStore();
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  const lat = latitude || MAP_DEFAULTS.defaultLatitude;
  const lng = longitude || MAP_DEFAULTS.defaultLongitude;

  const [radius, setRadius] = useState(3);
  const { data: reports, isLoading } = useNearbyReports(lat, lng, radius, true);

  const [showVets, setShowVets] = useState(false);
  const [selectedVet, setSelectedVet] = useState<Vet | null>(null);
  const { data: vets } = useNearbyVets(lat, lng, 5000, showVets);

  const circleGeoJSON = createCircleGeoJSON(lng, lat, radius);

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
      case 'lost':     return t('lost');
      case 'found':    return t('found');
      case 'sighting': return t('sighting');
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
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  return (
    <MapErrorBoundary>
      <View style={styles.container}>
        <MapLibreGL.MapView
          style={styles.map}
          styleURL={MAP_STYLE}
          onPress={() => { setSelectedReport(null); setSelectedVet(null); }}
        >
          <MapLibreGL.Camera
            ref={cameraRef}
            zoomLevel={12}
            centerCoordinate={[lng, lat]}
          />

          <MapLibreGL.UserLocation visible />

          <MapLibreGL.ShapeSource id="radiusCircle" shape={circleGeoJSON}>
            <MapLibreGL.FillLayer
              id="radiusFill"
              style={{ fillColor: '#6366f1', fillOpacity: 0.08 }}
            />
            <MapLibreGL.LineLayer
              id="radiusLine"
              style={{ lineColor: '#6366f1', lineWidth: 2, lineDasharray: [6, 4] }}
            />
          </MapLibreGL.ShapeSource>

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

          {showVets && vets?.map((vet) => (
            <MapLibreGL.PointAnnotation
              key={`vet-${vet.id}`}
              id={`vet-${vet.id}`}
              coordinate={[vet.longitude, vet.latitude]}
              onSelected={() => { setSelectedVet(vet); setSelectedReport(null); }}
            >
              <View style={[styles.marker, { backgroundColor: COLORS.primary }]} />
            </MapLibreGL.PointAnnotation>
          ))}
        </MapLibreGL.MapView>

        {/* Selector de radio */}
        <View style={styles.radiusSelector}>
          {[1, 3, 5, 10].map((km) => (
            <TouchableOpacity
              key={km}
              style={[styles.radiusButton, radius === km && styles.radiusButtonActive]}
              onPress={() => setRadius(km)}
            >
              <Text style={[styles.radiusButtonText, radius === km && styles.radiusButtonTextActive]}>
                {km}km
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.vetToggle, showVets && styles.vetToggleActive]}
          onPress={() => setShowVets((v) => !v)}
        >
          <Text style={[styles.vetToggleText, showVets && styles.vetToggleTextActive]}>
            🏥 {t('vetsToggle')}
          </Text>
        </TouchableOpacity>

        {/* Botón centrar en usuario */}
        <TouchableOpacity style={styles.centerButton} onPress={centerOnUser}>
          <Text style={styles.centerIcon}>📍</Text>
        </TouchableOpacity>

        {/* Leyenda */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.lost }]} />
            <Text style={styles.legendText}>{t('legendLost')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.found }]} />
            <Text style={styles.legendText}>{t('legendFound')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.sighting }]} />
            <Text style={styles.legendText}>{t('legendSighting')}</Text>
          </View>
        </View>

        {/* Contador */}
        <View style={styles.counter}>
          <Text style={styles.counterText}>
            {t('counter', { count: reports?.length || 0 })}
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
              {selectedReport.pet?.name || t('defaultPetName')}
            </Text>
            {selectedReport.location_description && (
              <Text style={styles.reportDesc}>
                {selectedReport.location_description}
              </Text>
            )}
            <Text style={styles.reportAction}>{t('viewDetails')}</Text>
          </TouchableOpacity>
        )}

        {selectedVet && (
          <View style={styles.reportCard}>
            <Text style={styles.reportName}>{selectedVet.name || t('vetDefaultName')}</Text>
            {selectedVet.address ? <Text style={styles.reportDesc}>{selectedVet.address}</Text> : null}
            <View style={{ flexDirection: 'row', gap: SPACING.md }}>
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${selectedVet.latitude},${selectedVet.longitude}`)
                }
              >
                <Text style={styles.reportAction}>{t('vetDirections')}</Text>
              </TouchableOpacity>
              {selectedVet.phone ? (
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${selectedVet.phone}`)}>
                  <Text style={styles.reportAction}>{t('vetCall')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={{ fontSize: 10, color: COLORS.textSecondary, marginTop: 6 }}>{t('vetAttribution')}</Text>
          </View>
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
  radiusSelector: {
    position: 'absolute',
    bottom: 240,
    left: SPACING.lg,
    flexDirection: 'row',
    gap: 8,
  },
  radiusButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1.5,
    borderColor: COLORS.border || '#e5e7eb',
  },
  radiusButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  radiusButtonText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  radiusButtonTextActive: {
    color: COLORS.white,
  },
  vetToggle: {
    position: 'absolute',
    bottom: 290,
    left: SPACING.lg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1.5,
    borderColor: COLORS.border || '#e5e7eb',
  },
  vetToggleActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  vetToggleText: { fontSize: FONTS.sizes.xs, fontWeight: '600', color: COLORS.textSecondary },
  vetToggleTextActive: { color: COLORS.white },
});
