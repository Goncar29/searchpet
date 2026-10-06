// ============================================================
// SearchPet — email verification gate
// Blocks its children until the account's email is verified, telling three
// states apart: loading (spinner), failed (message + retry), answered
// (verify notice or children). A failed request is NOT "unverified".
// ============================================================

import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useVerificationStatus } from '@shared/hooks';
import { type ThemeColors, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';

interface Props {
  /** Shown when the answer is "email not verified". */
  unverifiedMessage: string;
  verifyLabel: string;
  children: ReactNode;
}

export function VerifiedEmailGate({ unverifiedMessage, verifyLabel, children }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation(['common']);
  const router = useRouter();
  const { data, isLoading, isFetching, refetch } = useVerificationStatus({
    refetchOnMount: 'always',
  });

  // A cached "not verified" that is being re-checked is not an answer yet.
  const pending = isLoading || (isFetching === true && data?.email_verified !== true);

  if (pending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (!data) {
    // Settled without an answer: the request failed.
    return (
      <View style={styles.card}>
        <Text style={styles.text}>{t('common:error')}</Text>
        <TouchableOpacity style={styles.button} onPress={() => refetch()} accessibilityRole="button">
          <Text style={styles.buttonText}>{t('common:retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data.email_verified) {
    return (
      <View style={styles.card}>
        <Text style={styles.text}>{unverifiedMessage}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{verifyLabel}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  center: { paddingVertical: SPACING.xl, alignItems: 'center' },
  card: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.warning,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  text: {
    fontSize: FONTS.sizes.sm,
    color: c.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  button: {
    backgroundColor: c.primary,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
  },
  buttonText: { color: c.onPrimary, fontSize: FONTS.sizes.sm, fontWeight: '700' },
});
