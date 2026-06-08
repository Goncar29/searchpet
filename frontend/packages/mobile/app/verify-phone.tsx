// ============================================================
// SearchPet - Verify Phone Screen (OTP)
// ============================================================

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useSendSmsOTP, useConfirmSmsOTP } from '../../shared/hooks';
import { getErrorMessage } from '../../shared/utils/apiErrors';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';

type Step = 'phone' | 'code';

export default function VerifyPhoneScreen() {
  const { t } = useTranslation('verify');
  const router = useRouter();
  const sendSmsOTP = useSendSmsOTP();
  const confirmSmsOTP = useConfirmSmsOTP();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleSendCode = async () => {
    setPhoneError('');
    if (!phone.trim()) {
      setPhoneError(i18next.t('verify:errorRequired'));
      return;
    }
    try {
      await sendSmsOTP.mutateAsync(phone.trim());
      setStep('code');
      setResendCountdown(60);
    } catch (err) {
      setPhoneError(getErrorMessage(err, i18next.t));
    }
  };

  const handleResend = async () => {
    setCodeError('');
    try {
      await sendSmsOTP.mutateAsync(phone.trim());
      setResendCountdown(60);
    } catch (err) {
      setCodeError(getErrorMessage(err, i18next.t));
    }
  };

  const handleVerify = async () => {
    setCodeError('');
    if (code.length !== 6) {
      setCodeError(i18next.t('verify:errorCodeLength'));
      return;
    }
    try {
      await confirmSmsOTP.mutateAsync({ phone: phone.trim(), code });
      Alert.alert(i18next.t('verify:verifiedTitle'), i18next.t('verify:verifiedSuccess'), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      setCodeError(getErrorMessage(err, i18next.t));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>{t('back')}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('title')}</Text>
          <Text style={styles.subtitle}>
            {step === 'phone'
              ? t('stepPhoneDesc')
              : t('stepCodeDesc', { phone })}
          </Text>
        </View>

        {/* Step 1 — Phone input */}
        {step === 'phone' && (
          <View style={styles.card}>
            <Text style={styles.label}>{t('phoneLabel')}</Text>
            <TextInput
              style={[styles.input, phoneError ? styles.inputError : null]}
              value={phone}
              onChangeText={(text) => { setPhone(text); setPhoneError(''); }}
              placeholder={t('phonePlaceholder')}
              keyboardType="phone-pad"
              autoComplete="tel"
              autoFocus
              placeholderTextColor={COLORS.textMuted}
            />
            {phoneError ? (
              <Text style={styles.errorText}>{phoneError}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryButton, (sendSmsOTP.isPending || !phone.trim()) && styles.buttonDisabled]}
              onPress={handleSendCode}
              disabled={sendSmsOTP.isPending || !phone.trim()}
            >
              {sendSmsOTP.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryButtonText}>{t('send')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Step 2 — Code input */}
        {step === 'code' && (
          <View style={styles.card}>
            <Text style={styles.label}>{t('codeLabel')}</Text>
            <TextInput
              style={[styles.otpInput, codeError ? styles.inputError : null]}
              value={code}
              onChangeText={(text) => { setCode(text.replace(/\D/g, '').slice(0, 6)); setCodeError(''); }}
              placeholder="000000"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              placeholderTextColor={COLORS.textMuted}
            />
            {codeError ? (
              <Text style={styles.errorText}>{codeError}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryButton, confirmSmsOTP.isPending && styles.buttonDisabled]}
              onPress={handleVerify}
              disabled={confirmSmsOTP.isPending}
            >
              {confirmSmsOTP.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryButtonText}>{t('verify')}</Text>
              )}
            </TouchableOpacity>

            {resendCountdown > 0 ? (
              <Text style={styles.resendCountdown}>{t('resendIn', { seconds: resendCountdown })}</Text>
            ) : (
              <TouchableOpacity
                onPress={handleResend}
                disabled={sendSmsOTP.isPending}
                style={styles.resendButton}
              >
                <Text style={[styles.resendText, sendSmsOTP.isPending && styles.textDisabled]}>
                  {sendSmsOTP.isPending ? t('sending') : t('resend')}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.changeNumberButton}
              onPress={() => { setStep('phone'); setCode(''); setCodeError(''); }}
            >
              <Text style={styles.changeNumberText}>{t('changeNumber')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
    paddingTop: SPACING.xl,
  },
  header: {
    marginBottom: SPACING.xl,
  },
  backButton: {
    marginBottom: SPACING.md,
  },
  backButtonText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
  },
  title: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    ...SHADOWS.md,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  otpInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: 28,
    letterSpacing: 10,
    textAlign: 'center',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  inputError: {
    borderColor: COLORS.danger,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: FONTS.sizes.sm,
    marginBottom: SPACING.sm,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  resendCountdown: {
    textAlign: 'center',
    color: COLORS.textMuted,
    fontSize: FONTS.sizes.sm,
    marginBottom: SPACING.sm,
  },
  resendButton: {
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  resendText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  textDisabled: {
    opacity: 0.6,
  },
  changeNumberButton: {
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  changeNumberText: {
    color: COLORS.textMuted,
    fontSize: FONTS.sizes.sm,
  },
});
