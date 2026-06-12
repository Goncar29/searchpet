import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import MapLibreGL from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { COLORS, SPACING, FONTS, RADIUS, MAP_DEFAULTS } from '../../constants';
import type { InitialReportRequest } from '../../../shared/types';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

interface LocationStepProps {
  value: InitialReportRequest | null;
  onPublish: (location: InitialReportRequest) => void;
  onBack: () => void;
  isPending: boolean;
}

export function LocationStep({ value, onPublish, onBack, isPending }: LocationStepProps) {
  const { t } = useTranslation();
  const [coordinate, setCoordinate] = useState<[number, number]>(
    value ? [value.longitude, value.latitude] : [MAP_DEFAULTS.defaultLongitude, MAP_DEFAULTS.defaultLatitude]
  );
  const [note, setNote] = useState(value?.note ?? '');
  const [locationError, setLocationError] = useState<string | null>(null);

  const useMyLocation = async () => {
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError(t('publish:location.locationDenied'));
        return;
      }
      const location = await Location.getCurrentPositionAsync({});
      setCoordinate([location.coords.longitude, location.coords.latitude]);
    } catch {
      setLocationError(t('publish:location.locationDenied'));
    }
  };

  const handlePublish = () => {
    onPublish({ latitude: coordinate[1], longitude: coordinate[0], note: note.trim() || undefined });
  };

  return (
    <View>
      <Text style={styles.title}>{t('publish:location.title')}</Text>
      <Text style={styles.instructions}>{t('publish:location.instructions')}</Text>

      <View style={styles.mapContainer}>
        <MapLibreGL.MapView style={styles.map} styleURL={MAP_STYLE}>
          <MapLibreGL.Camera zoomLevel={13} centerCoordinate={coordinate} />
          <MapLibreGL.UserLocation visible />
          <MapLibreGL.PointAnnotation
            id="publish-pin"
            coordinate={coordinate}
            draggable
            onDragEnd={(e) => setCoordinate(e.geometry.coordinates as [number, number])}
          >
            <View style={styles.pin} />
          </MapLibreGL.PointAnnotation>
        </MapLibreGL.MapView>
      </View>

      <TouchableOpacity style={styles.locationButton} onPress={useMyLocation}>
        <Text style={styles.locationButtonText}>{t('publish:location.useMyLocation')}</Text>
      </TouchableOpacity>
      {locationError && <Text style={styles.error}>{locationError}</Text>}

      <Text style={styles.label}>{t('publish:location.noteLabel')}</Text>
      <TextInput
        testID="location-note-input"
        style={[styles.input, styles.textArea]}
        value={note}
        onChangeText={setNote}
        placeholder={t('publish:location.notePlaceholder')}
        placeholderTextColor={COLORS.placeholder}
        multiline
        numberOfLines={2}
      />

      <View style={styles.actions}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>{t('publish:location.back')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.publishButton, isPending && styles.disabled]} onPress={handlePublish} disabled={isPending}>
          <Text style={styles.publishButtonText}>{t('publish:location.publish')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm, textAlign: 'center' },
  instructions: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', marginBottom: SPACING.md },
  mapContainer: { height: 280, borderRadius: RADIUS.lg, overflow: 'hidden', marginBottom: SPACING.md },
  map: { flex: 1 },
  pin: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.lost, borderWidth: 2, borderColor: COLORS.white },
  locationButton: { borderWidth: 2, borderColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md, alignItems: 'center', marginBottom: SPACING.sm },
  locationButtonText: { color: COLORS.primary, fontWeight: '700' },
  error: { fontSize: FONTS.sizes.xs, color: COLORS.danger, textAlign: 'center', marginBottom: SPACING.sm },
  label: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.xs, marginTop: SPACING.sm },
  input: {
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: 14, fontSize: FONTS.sizes.md, color: COLORS.textPrimary,
  },
  textArea: { minHeight: 60, paddingTop: 14, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
  backButton: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingVertical: SPACING.md, alignItems: 'center' },
  backButtonText: { color: COLORS.textPrimary, fontWeight: '700' },
  publishButton: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md, alignItems: 'center' },
  publishButtonText: { color: COLORS.white, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
