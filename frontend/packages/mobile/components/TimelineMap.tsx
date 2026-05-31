import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import type { Report } from '../../shared/types';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';

interface TimelineMapProps {
  reports: Report[];
}

interface ValidReport {
  id: string;
  latitude: number;
  longitude: number;
  status: string;
  label: string | undefined;
  date: string;
}

function getMarkerColor(status: string): string {
  switch (status) {
    case 'found': return COLORS.found;
    case 'sighting': return COLORS.sighting;
    default: return COLORS.lost;
  }
}

function chronological(reports: ValidReport[]): ValidReport[] {
  return [...reports].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function TimelineMap({ reports }: TimelineMapProps) {
  const [showMap, setShowMap] = useState(false);
  const [MapLibreGL, setMapLibreGL] = useState<typeof import('@maplibre/maplibre-react-native') | null>(null);

  const validReports: ValidReport[] = reports
    .filter((r) => r.latitude && r.longitude)
    .map((r) => ({
      id: r.id,
      latitude: r.latitude,
      longitude: r.longitude,
      status: r.status,
      label: r.location_description,
      date: r.occurred_at ?? r.created_at,
    }));

  if (validReports.length === 0) return null;

  const sorted = chronological(validReports);

  const handleToggle = async () => {
    if (showMap) {
      setShowMap(false);
      return;
    }
    if (!MapLibreGL) {
      const lib = await import('@maplibre/maplibre-react-native');
      lib.default.setAccessToken(null);
      setMapLibreGL(lib);
    }
    setShowMap(true);
  };

  const center: [number, number] = [sorted[0].longitude, sorted[0].latitude];

  const lineGeoJSON = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: sorted.map((r) => [r.longitude, r.latitude]),
    },
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handleToggle} style={styles.toggle}>
        <Text style={styles.toggleText}>
          {showMap ? 'Ocultar mapa' : 'Mostrar mapa'}
        </Text>
      </TouchableOpacity>

      {showMap && MapLibreGL && (
        <View style={styles.mapWrapper}>
          <MapLibreGL.default.MapView
            style={styles.map}
            styleURL="https://tiles.openfreemap.org/styles/liberty"
          >
            <MapLibreGL.default.Camera
              zoomLevel={12}
              centerCoordinate={center}
              bounds={{
                ne: [
                  Math.max(...sorted.map((r) => r.longitude)) + 0.01,
                  Math.max(...sorted.map((r) => r.latitude)) + 0.01,
                ],
                sw: [
                  Math.min(...sorted.map((r) => r.longitude)) - 0.01,
                  Math.min(...sorted.map((r) => r.latitude)) - 0.01,
                ],
                paddingTop: 40,
                paddingBottom: 40,
                paddingLeft: 40,
                paddingRight: 40,
              }}
            />

            {sorted.map((r) => (
              <MapLibreGL.default.PointAnnotation
                key={r.id}
                id={`tl-marker-${r.id}`}
                coordinate={[r.longitude, r.latitude]}
              >
                <View style={[styles.marker, { backgroundColor: getMarkerColor(r.status) }]} />
              </MapLibreGL.default.PointAnnotation>
            ))}

            {sorted.length >= 2 && (
              <MapLibreGL.default.ShapeSource id="timeline-line-src" shape={lineGeoJSON}>
                <MapLibreGL.default.LineLayer
                  id="timeline-line"
                  style={{ lineColor: '#6366f1', lineWidth: 2 }}
                />
              </MapLibreGL.default.ShapeSource>
            )}
          </MapLibreGL.default.MapView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.md,
  },
  toggle: {
    paddingVertical: SPACING.xs,
  },
  toggleText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.primary,
  },
  mapWrapper: {
    marginTop: SPACING.sm,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  map: {
    height: 240,
  },
  marker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
});
