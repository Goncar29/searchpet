// ============================================================
// SearchPet - Paso de ubicación para cuentas creadas con Google
// ============================================================

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../shared/api/client';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';

/**
 * Una cuenta de Google llega sin ubicación, y la búsqueda cercana es el punto de
 * la app. Se pregunta una sola vez y SIEMPRE se puede omitir: negar el permiso es
 * una decisión válida, no una falla. Nada acá puede dejar al usuario trabado —
 * la ubicación también se carga después desde el perfil.
 */
export default function GoogleLocationScreen() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const [isLoading, setIsLoading] = useState(false);

  const finish = () => router.replace('/');

  const handleAllow = async () => {
    setIsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const position = await Location.getCurrentPositionAsync({});
      await apiClient.updateMyLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch {
      // Best-effort: si el PATCH falla, el alta ya está hecha y la ubicación se
      // puede cargar más tarde. Trabar acá sería peor que no tenerla.
    } finally {
      setIsLoading(false);
      finish();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('location.title')}</Text>
      <Text style={styles.subtitle}>{t('location.subtitle')}</Text>

      <TouchableOpacity
        testID="use-my-location"
        style={styles.primary}
        onPress={handleAllow}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.primaryLabel}>{t('location.useMyLocation')}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity testID="skip-location" onPress={finish} disabled={isLoading}>
        <Text style={styles.skip}>{t('location.skip')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.xl,
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xl,
  },
  primary: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  primaryLabel: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
  },
  skip: {
    textAlign: 'center',
    marginTop: SPACING.lg,
    color: COLORS.textSecondary,
  },
});
