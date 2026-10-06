// ============================================================
// SearchPet — Mis Alertas de Ubicación
// Permite crear alertas que disparan push cuando hay un reporte
// cerca de una zona definida por el usuario.
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as Location from 'expo-location';
import { useAlerts, useCreateAlert, useUpdateAlert, useDeleteAlert } from '../../../shared/hooks';
import { getErrorMessage } from '../../../shared/utils/apiErrors';
import { ListState } from '../../components/list/ListState';
import { useLocationStore } from '../../store';
import { SPACING, FONTS, RADIUS, SHADOWS, PET_TYPES, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { IconLabel } from '../../components/IconLabel';
import { Icon } from '../../components/Icon';
import type { LocationAlert, PetType } from '../../../shared/types';

const RADIUS_OPTIONS = [1, 2, 5, 10, 25] as const;

export default function AlertsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('alerts');
  const { latitude, longitude } = useLocationStore();

  const alertsQuery = useAlerts();
  const { isLoading } = alertsQuery;
  const createAlert = useCreateAlert();
  const updateAlert = useUpdateAlert();
  const deleteAlert = useDeleteAlert();

  // ── Form state ──
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [radiusKm, setRadiusKm] = useState<1 | 2 | 5 | 10 | 25>(5);
  const [petType, setPetType] = useState<PetType | ''>('');
  const [locating, setLocating] = useState(false);
  const [formLat, setFormLat] = useState<number | null>(latitude);
  const [formLng, setFormLng] = useState<number | null>(longitude);

  const useCurrentLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(i18next.t('alerts:locationRequired'), i18next.t('alerts:locationPermission'));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setFormLat(loc.coords.latitude);
      setFormLng(loc.coords.longitude);
    } catch (err: unknown) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
    } finally {
      setLocating(false);
    }
  };

  const handleCreate = async () => {
    if (!formLat || !formLng) {
      Alert.alert(i18next.t('alerts:locationRequired'), i18next.t('alerts:locationRequiredText'));
      return;
    }

    try {
      await createAlert.mutateAsync({
        latitude: formLat,
        longitude: formLng,
        radius_km: radiusKm,
        name: name.trim() || undefined,
        pet_type: petType || undefined,
      });
      // Reset form
      setShowForm(false);
      setName('');
      setRadiusKm(5);
      setPetType('');
    } catch (err: unknown) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
    }
  };

  const handleToggle = async (alert: LocationAlert) => {
    try {
      await updateAlert.mutateAsync({
        id: alert.id,
        data: { is_active: !alert.is_active },
      });
    } catch (err: unknown) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
    }
  };

  const handleDelete = (alert: LocationAlert) => {
    Alert.alert(
      i18next.t('alerts:deleteConfirm'),
      `"${alert.name || i18next.t('alerts:noName')}"?`,
      [
        { text: i18next.t('alerts:cancel'), style: 'cancel' },
        {
          text: i18next.t('alerts:delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAlert.mutateAsync(alert.id);
            } catch (err: unknown) {
              Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* ── Intro ── */}
        <View style={styles.intro}>
          <IconLabel icon="notifications" size={18} color={colors.primary} gap={SPACING.xs} style={{ marginBottom: 4 }}>
            <Text style={[styles.introTitle, { marginBottom: 0 }]}>{t('alerts:introTitle')}</Text>
          </IconLabel>
          <Text style={styles.introText}>{t('alerts:introText')}</Text>
        </View>

        {/* ── Botón crear ── */}
        {!showForm && (
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => {
              setFormLat(latitude);
              setFormLng(longitude);
              setShowForm(true);
            }}
          >
            <Text style={styles.createButtonText}>+ {t('alerts:add')}</Text>
          </TouchableOpacity>
        )}

        {/* ── Formulario ── */}
        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{t('alerts:formTitle')}</Text>

            {/* Nombre */}
            <Text style={styles.fieldLabel}>{t('alerts:nameLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('alerts:namePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              maxLength={60}
            />

            {/* Ubicación */}
            <Text style={styles.fieldLabel}>{t('alerts:locationLabel')}</Text>
            <TouchableOpacity
              style={[styles.locationButton, locating && { opacity: 0.6 }]}
              onPress={useCurrentLocation}
              disabled={locating}
            >
              {locating ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <IconLabel icon="location-on" size={16} color={colors.primary}>
                  <Text style={styles.locationButtonText}>
                    {formLat && formLng
                      ? t('alerts:locationSet', { lat: formLat.toFixed(4), lng: formLng.toFixed(4) })
                      : t('alerts:useCurrentLocation')}
                  </Text>
                </IconLabel>
              )}
            </TouchableOpacity>

            {/* Radio */}
            <Text style={styles.fieldLabel}>{t('alerts:radiusLabel')}</Text>
            <View style={styles.radiusRow}>
              {RADIUS_OPTIONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.radiusChip, radiusKm === r && styles.radiusChipActive]}
                  onPress={() => setRadiusKm(r)}
                >
                  <Text style={[styles.radiusChipText, radiusKm === r && styles.radiusChipTextActive]}>
                    {r} km
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Tipo de mascota */}
            <Text style={styles.fieldLabel}>{t('alerts:typeLabel')}</Text>
            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[styles.typeChip, petType === '' && styles.typeChipActive]}
                onPress={() => setPetType('')}
              >
                <Text style={[styles.typeChipText, petType === '' && styles.typeChipTextActive]}>{t('alerts:allTypes')}</Text>
              </TouchableOpacity>
              {PET_TYPES.map((petTypeOption) => (
                <TouchableOpacity
                  key={petTypeOption.value}
                  style={[styles.typeChip, petType === petTypeOption.value && styles.typeChipActive]}
                  onPress={() => setPetType(petType === petTypeOption.value ? '' : petTypeOption.value as PetType)}
                >
                  <IconLabel
                    icon={petTypeOption.icon}
                    size={18}
                    color={petType === petTypeOption.value ? colors.onPrimary : colors.textSecondary}
                  >
                    <Text style={[styles.typeChipText, petType === petTypeOption.value && styles.typeChipTextActive]}>
                      {t(petTypeOption.labelKey)}
                    </Text>
                  </IconLabel>
                </TouchableOpacity>
              ))}
            </View>

            {/* Acciones */}
            <View style={styles.formActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowForm(false)}
              >
                <Text style={styles.cancelButtonText}>{t('alerts:cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, createAlert.isPending && { opacity: 0.6 }]}
                onPress={handleCreate}
                disabled={createAlert.isPending}
              >
                {createAlert.isPending
                  ? <ActivityIndicator size="small" color={colors.onPrimary} />
                  : <Text style={styles.saveButtonText}>{t('alerts:createButton')}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Lista de alertas ──
            Wrapped with ListState (rule #60): a failed `useAlerts` used to
            fall through to the empty state and tell the user "no active
            alerts", which is false when we simply could not read them. */}
        <ListState<LocationAlert[], LocationAlert>
          query={alertsQuery}
          loading={
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          }
        >
          {(alerts) =>
            alerts.length > 0 ? (
              <View style={styles.alertsList}>
                <Text style={styles.sectionTitle}>
                  {t('alerts:myAlertsCount', { count: alerts.length })}
                </Text>
                {alerts.map((alert) => (
                  <View key={alert.id} style={styles.alertCard}>
                    <View style={styles.alertHeader}>
                      <View style={styles.alertInfo}>
                        <Text style={styles.alertName}>
                          {alert.name || t('alerts:noName')}
                        </Text>
                        <IconLabel icon="location-on" size={13} color={colors.textSecondary} gap={2}>
                          <Text style={[styles.alertMeta, { flexShrink: 1 }]}>
                            {alert.alert_latitude?.toFixed(3)}, {alert.alert_longitude?.toFixed(3)}
                            {'  ·  '}{alert.radius_km} km
                            {/* Translated (rule #12/#60-adjacent M5): the raw
                                literal ('perro', 'gato'...) showed untranslated
                                regardless of the app's language. */}
                            {alert.pet_type ? `  ·  ${t(`pets:types.${alert.pet_type}`, { defaultValue: alert.pet_type })}` : ''}
                          </Text>
                        </IconLabel>
                      </View>
                      <Switch
                        value={alert.is_active}
                        onValueChange={() => handleToggle(alert)}
                        trackColor={{ false: colors.border, true: colors.primary + '80' }}
                        thumbColor={alert.is_active ? colors.primary : colors.textMuted}
                      />
                    </View>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDelete(alert)}
                    >
                      <Text style={styles.deleteText}>{t('alerts:delete')}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : !showForm ? (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}><Icon name="notifications-off" size={56} color={colors.textMuted} /></View>
                <Text style={styles.emptyTitle}>{t('alerts:emptyTitle')}</Text>
                <Text style={styles.emptyText}>{t('alerts:emptyText')}</Text>
              </View>
            ) : null
          }
        </ListState>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  intro: {
    margin: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: c.primary + '15',
    borderRadius: RADIUS.lg,
    borderLeftWidth: 3,
    borderLeftColor: c.primary,
  },
  introTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: c.primary, marginBottom: 4 },
  introText: { fontSize: FONTS.sizes.sm, color: c.textSecondary, lineHeight: 20 },

  createButton: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    backgroundColor: c.primary,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  createButtonText: { color: c.onPrimary, fontSize: FONTS.sizes.md, fontWeight: '700' },

  // ── Formulario ──
  formCard: {
    margin: SPACING.lg,
    padding: SPACING.lg,
    backgroundColor: c.card,
    borderRadius: RADIUS.lg,
    ...SHADOWS.md,
  },
  formTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: c.textPrimary, marginBottom: SPACING.md },
  fieldLabel: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: c.textSecondary, marginBottom: 6, marginTop: SPACING.sm },
  input: {
    backgroundColor: c.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONTS.sizes.sm,
    color: c.textPrimary,
    borderWidth: 1,
    borderColor: c.border,
  },
  locationButton: {
    backgroundColor: c.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
  },
  locationButtonText: { fontSize: FONTS.sizes.sm, color: c.primary, fontWeight: '600' },
  radiusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  radiusChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
  },
  radiusChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  radiusChipText: { fontSize: FONTS.sizes.sm, color: c.textSecondary, fontWeight: '500' },
  radiusChipTextActive: { color: c.onPrimary, fontWeight: '700' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
  },
  typeChipActive: { backgroundColor: c.secondary, borderColor: c.secondary },
  typeChipText: { fontSize: FONTS.sizes.sm, color: c.textSecondary, fontWeight: '500' },
  typeChipTextActive: { color: c.onPrimary, fontWeight: '700' },
  formActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
  cancelButton: {
    flex: 1, paddingVertical: 12, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: c.border, alignItems: 'center',
  },
  cancelButtonText: { color: c.textSecondary, fontSize: FONTS.sizes.sm, fontWeight: '600' },
  saveButton: {
    flex: 2, paddingVertical: 12, borderRadius: RADIUS.md,
    backgroundColor: c.primary, alignItems: 'center',
  },
  saveButtonText: { color: c.onPrimary, fontSize: FONTS.sizes.sm, fontWeight: '700' },

  // ── Lista ──
  alertsList: { marginHorizontal: SPACING.lg },
  sectionTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: c.textPrimary, marginBottom: SPACING.md },
  alertCard: {
    backgroundColor: c.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  alertInfo: { flex: 1, marginRight: SPACING.sm },
  alertName: { fontSize: FONTS.sizes.md, fontWeight: '600', color: c.textPrimary },
  alertMeta: { fontSize: FONTS.sizes.xs, color: c.textMuted, marginTop: 2 },
  deleteButton: { alignSelf: 'flex-start' },
  deleteText: { fontSize: FONTS.sizes.xs, color: c.danger, fontWeight: '600' },

  // ── Empty ──
  empty: { alignItems: 'center', padding: SPACING.xl, marginTop: SPACING.lg },
  emptyIcon: { marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: c.textPrimary, marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sizes.sm, color: c.textSecondary, textAlign: 'center', lineHeight: 22 },
});
