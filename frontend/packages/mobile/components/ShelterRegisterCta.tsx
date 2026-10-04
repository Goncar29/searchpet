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
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';

export function ShelterRegisterCta() {
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
        <ActivityIndicator size="small" color={COLORS.primary} />
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

const styles = StyleSheet.create({
  loading: { paddingVertical: SPACING.lg, alignItems: 'center' },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  body: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
  },
  buttonText: { color: COLORS.white, fontSize: FONTS.sizes.sm, fontWeight: '700' },
  label: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginBottom: SPACING.xs },
  name: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  badge: {
    backgroundColor: COLORS.warning,
    paddingHorizontal: SPACING.md,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  badgeApproved: { backgroundColor: COLORS.success },
  badgeRejected: { backgroundColor: COLORS.danger },
  badgeText: { color: COLORS.white, fontSize: FONTS.sizes.xs, fontWeight: '700' },
  reason: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});
