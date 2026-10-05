// ============================================================
// SearchPet — call to action at the bottom of the shelters directory.
// Mirrors the web CTA (SheltersPage): logged out -> login; has a shelter ->
// its name and review status; otherwise -> register.
// ============================================================

import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMyShelter } from '@shared/hooks';
import { useAuthStore } from '../store';
import { type ThemeColors, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';

export function ShelterRegisterCta() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation(['shelters']);
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // The owner view needs a session; without one it would only 401.
  const { data: myShelter, isLoading } = useMyShelter(isAuthenticated);

  if (!isAuthenticated) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t('shelters:registerCta')}</Text>
        <Text style={styles.body}>{t('shelters:registerCtaBody')}</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.push('/login')} accessibilityRole="button">
          <Text style={styles.buttonText}>{t('shelters:loginToRegister')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Not knowing yet is not "no shelter": do not flash the register button.
  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (myShelter) {
    const rejected = myShelter.status === 'rejected';
    return (
      <View style={styles.card}>
        <Text style={styles.label}>{t('shelters:myShelter.title')}</Text>
        <Text style={styles.name}>{myShelter.name}</Text>
        <View style={[styles.badge, rejected && styles.badgeRejected, myShelter.status === 'approved' && styles.badgeApproved]}>
          <Text style={styles.badgeText}>{t(`shelters:myShelter.status.${myShelter.status}`)}</Text>
        </View>
        {rejected && myShelter.rejection_reason ? (
          <Text style={styles.reason}>
            {t('shelters:myShelter.rejectedReason', { reason: myShelter.rejection_reason })}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('shelters:registerCta')}</Text>
      <Text style={styles.body}>{t('shelters:registerCtaBody')}</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push('/shelters/register')}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>{t('shelters:registerButton')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  loading: { paddingVertical: SPACING.lg, alignItems: 'center' },
  card: {
    backgroundColor: c.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: c.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  body: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  button: {
    backgroundColor: c.primary,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
  },
  buttonText: { color: c.onPrimary, fontSize: FONTS.sizes.sm, fontWeight: '700' },
  label: { fontSize: FONTS.sizes.xs, color: c.textMuted, marginBottom: SPACING.xs },
  name: { fontSize: FONTS.sizes.md, fontWeight: '700', color: c.textPrimary, marginBottom: SPACING.sm },
  badge: {
    backgroundColor: c.warning,
    paddingHorizontal: SPACING.md,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  badgeApproved: { backgroundColor: c.success },
  badgeRejected: { backgroundColor: c.danger },
  badgeText: { color: c.onPrimary, fontSize: FONTS.sizes.xs, fontWeight: '700' },
  reason: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});
