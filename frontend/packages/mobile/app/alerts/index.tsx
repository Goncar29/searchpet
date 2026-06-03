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
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as Location from 'expo-location';
import { useAlerts, useCreateAlert, useUpdateAlert, useDeleteAlert } from '../../../shared/hooks';
import { useLocationStore } from '../../store';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS, PET_TYPES } from '../../constants';
import type { LocationAlert, PetType } from '../../../shared/types';

const RADIUS_OPTIONS = [1, 2, 5, 10, 25] as const;

export default function AlertsScreen() {
  const router = useRouter();
  const { t } = useTranslation('alerts');
  const { latitude, longitude } = useLocationStore();

  const { data: alerts, isLoading } = useAlerts();
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
    } catch {
      Alert.alert('Error', i18next.t('alerts:locationError'));
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
    } catch (err: any) {
      Alert.alert('Error', err?.message || i18next.t('alerts:createError'));
    }
  };

  const handleToggle = async (alert: LocationAlert) => {
    try {
      await updateAlert.mutateAsync({
        id: alert.id,
        data: { is_active: !alert.is_active },
      });
    } catch {
      Alert.alert('Error', i18next.t('alerts:updateError'));
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
            } catch {
              Alert.alert('Error', i18next.t('alerts:deleteError'));
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* ── Intro ── */}
        <View style={styles.intro}>
          <Text style={styles.introTitle}>🔔 {t('alerts:introTitle')}</Text>
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
              placeholderTextColor={COLORS.textMuted}
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
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Text style={styles.locationButtonText}>
                  {formLat && formLng
                    ? `📍 ${t('alerts:locationSet', { lat: formLat.toFixed(4), lng: formLng.toFixed(4) })}`
                    : `📍 ${t('alerts:useCurrentLocation')}`}
                </Text>
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
                  <Text style={[styles.typeChipText, petType === petTypeOption.value && styles.typeChipTextActive]}>
                    {petTypeOption.icon} {t(petTypeOption.labelKey)}
                  </Text>
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
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <Text style={styles.saveButtonText}>{t('alerts:createButton')}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Lista de alertas ── */}
        {alerts && alerts.length > 0 ? (
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
                    <Text style={styles.alertMeta}>
                      📍 {alert.alert_latitude?.toFixed(3)}, {alert.alert_longitude?.toFixed(3)}
                      {'  ·  '}{alert.radius_km} km
                      {alert.pet_type ? `  ·  ${alert.pet_type}` : ''}
                    </Text>
                  </View>
                  <Switch
                    value={alert.is_active}
                    onValueChange={() => handleToggle(alert)}
                    trackColor={{ false: COLORS.border, true: COLORS.primary + '80' }}
                    thumbColor={alert.is_active ? COLORS.primary : COLORS.textMuted}
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
            <Text style={styles.emptyIcon}>🔕</Text>
            <Text style={styles.emptyTitle}>{t('alerts:emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('alerts:emptyText')}</Text>
          </View>
        ) : null}

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  intro: {
    margin: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: COLORS.primary + '15',
    borderRadius: RADIUS.lg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  introTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.primary, marginBottom: 4 },
  introText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, lineHeight: 20 },

  createButton: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  createButtonText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },

  // ── Formulario ──
  formCard: {
    margin: SPACING.lg,
    padding: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    ...SHADOWS.md,
  },
  formTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.md },
  fieldLabel: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6, marginTop: SPACING.sm },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  locationButton: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  locationButtonText: { fontSize: FONTS.sizes.sm, color: COLORS.primary, fontWeight: '600' },
  radiusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  radiusChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  radiusChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  radiusChipText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, fontWeight: '500' },
  radiusChipTextActive: { color: COLORS.white, fontWeight: '700' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  typeChipActive: { backgroundColor: COLORS.secondary, borderColor: COLORS.secondary },
  typeChipText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, fontWeight: '500' },
  typeChipTextActive: { color: COLORS.white, fontWeight: '700' },
  formActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
  cancelButton: {
    flex: 1, paddingVertical: 12, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, alignItems: 'center',
  },
  cancelButtonText: { color: COLORS.textSecondary, fontSize: FONTS.sizes.sm, fontWeight: '600' },
  saveButton: {
    flex: 2, paddingVertical: 12, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary, alignItems: 'center',
  },
  saveButtonText: { color: COLORS.white, fontSize: FONTS.sizes.sm, fontWeight: '700' },

  // ── Lista ──
  alertsList: { marginHorizontal: SPACING.lg },
  sectionTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.md },
  alertCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  alertInfo: { flex: 1, marginRight: SPACING.sm },
  alertName: { fontSize: FONTS.sizes.md, fontWeight: '600', color: COLORS.textPrimary },
  alertMeta: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: 2 },
  deleteButton: { alignSelf: 'flex-start' },
  deleteText: { fontSize: FONTS.sizes.xs, color: COLORS.danger, fontWeight: '600' },

  // ── Empty ──
  empty: { alignItems: 'center', padding: SPACING.xl, marginTop: SPACING.lg },
  emptyIcon: { fontSize: 56, marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
});
