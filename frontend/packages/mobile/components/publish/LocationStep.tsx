import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import MapLibreGL from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { COLORS, SPACING, FONTS, RADIUS, MAP_DEFAULTS } from '../../constants';
import type { InitialReportRequest } from '../../../shared/types';
import { calendarDayToISO, isFutureCalendarDay, isoToCalendarDay } from '../../../shared/utils/reportDate';

// MapLibre no necesita token de Mapbox
MapLibreGL.setAccessToken(null);

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
  // Campo de texto y no un date picker nativo a proposito: el picker es un
  // modulo NATIVO, y sumarlo obliga a rebuildear el APK y el dev client. El
  // dato que faltaba es la fecha, no el widget; el picker es una mejora de UX
  // posterior que no cambia este contrato.
  // El dia LOCAL del instante guardado, no `iso.slice(0, 10)`: el slice lee el
  // dia en UTC y al este de Greenwich rehidrata el dia anterior, restando uno
  // mas en cada ida y vuelta por el paso de login.
  const [date, setDate] = useState(() => isoToCalendarDay(value?.occurred_at));
  const [dateError, setDateError] = useState<string | null>(null);
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

  // Se valida aca y no solo en el backend porque el rechazo del servidor llega
  // como invalid_input generico, sin decir cual campo: el usuario veria un
  // error rojo sin saber que corregir.
  const parseDate = (raw: string): { iso?: string; error?: string } => {
    const limpio = raw.trim();
    if (!limpio) return {};
    // calendarDayToISO valida el formato Y que el dia exista (un 31 de febrero
    // rebota al 3 de marzo si no se chequea), y convierte a la medianoche
    // LOCAL: mandar `${dia}T00:00:00Z` guarda el dia anterior en toda zona al
    // oeste de Greenwich. Ver shared/utils/reportDate.ts.
    const iso = calendarDayToISO(limpio);
    if (!iso) return { error: t('publish:location.dateInvalid') };
    if (isFutureCalendarDay(limpio)) return { error: t('publish:location.dateFuture') };
    return { iso };
  };

  const handlePublish = () => {
    const { iso, error } = parseDate(date);
    setDateError(error ?? null);
    if (error) return;
    onPublish({
      latitude: coordinate[1],
      longitude: coordinate[0],
      note: note.trim() || undefined,
      occurred_at: iso,
    });
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

      <TouchableOpacity style={styles.locationButton} onPress={useMyLocation} accessibilityRole="button">
        <Text style={styles.locationButtonText}>{t('publish:location.useMyLocation')}</Text>
      </TouchableOpacity>
      {locationError && <Text style={styles.error}>{locationError}</Text>}

      <Text style={styles.label}>{t('publish:location.dateLabel')}</Text>
      <TextInput
        testID="location-date-input"
        style={styles.input}
        value={date}
        onChangeText={(v) => {
          setDate(v);
          if (dateError) setDateError(null);
        }}
        placeholder="2026-08-04"
        placeholderTextColor={COLORS.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      {dateError ? (
        <Text style={styles.error}>{dateError}</Text>
      ) : (
        <Text style={styles.help}>{t('publish:location.dateHelp')}</Text>
      )}

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
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button">
          <Text style={styles.backButtonText}>{t('publish:location.back')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.publishButton, isPending && styles.disabled]} onPress={handlePublish} disabled={isPending} accessibilityRole="button">
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
  help: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: SPACING.xs },
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
