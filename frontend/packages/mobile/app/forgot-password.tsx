// ============================================================
// SearchPet - Forgot Password Screen (two-step: request code, then reset)
// ============================================================

import { useState } from 'react';
import { Logo } from '../components/Logo';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { apiClient } from '../../shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';

type Step = 'email' | 'code';

// Igual al min=6 de ResetPasswordRequest en el backend, que a su vez iguala a
// RegisterRequest: exigir más en la recuperación que en el alta sería incoherente.
const MIN_PASSWORD_LENGTH = 6;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { t } = useTranslation('auth');

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRequestCode = async () => {
    setIsLoading(true);
    try {
      await apiClient.forgotPassword(email.trim());
      // SECURITY: always advance, whether or not the address is registered.
      // The backend answers 200 either way (PasswordResetService.RequestReset)
      // so it cannot be used to probe which addresses exist — branching here
      // would rebuild that same oracle in the client.
      setStep('code');
    } catch (error) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    // Sin este chequeo una contraseña corta vuelve como binding_failed ("datos de
    // entrada inválidos"), que no dice cuál dato — y en esta pantalla el fallo que
    // el usuario espera es "el código está mal", así que apunta al campo
    // equivocado. register.tsx ya valida igual.
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      Alert.alert(i18next.t('common:error'), t('register.passwordMin'));
      return;
    }

    setIsLoading(true);
    try {
      await apiClient.resetPassword(email.trim(), code.trim(), newPassword);
      Alert.alert(t('forgotPassword.title'), t('forgotPassword.success'), [
        { text: 'OK', onPress: () => router.replace('/login') },
      ]);
    } catch (error) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <View style={styles.logo}><Logo size={64} /></View>
        <Text style={styles.title}>{t('forgotPassword.title')}</Text>
        <Text style={styles.subtitle}>
          {step === 'email' ? t('forgotPassword.emailStepDescription') : t('forgotPassword.codeStepDescription')}
        </Text>

        {step === 'email' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder={t('forgotPassword.email')}
              placeholderTextColor={COLORS.placeholder}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <TouchableOpacity
              style={[styles.button, (isLoading || !email.trim()) && styles.buttonDisabled]}
              onPress={handleRequestCode}
              disabled={isLoading || !email.trim()}
            >
              {isLoading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.buttonText}>{t('forgotPassword.sendCode')}</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder={t('forgotPassword.code')}
              placeholderTextColor={COLORS.placeholder}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
            />

            <TextInput
              style={styles.input}
              placeholder={t('forgotPassword.newPassword')}
              placeholderTextColor={COLORS.placeholder}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              textContentType="newPassword"
            />

            <Text style={styles.sessionsWarning}>{t('forgotPassword.sessionsWarning')}</Text>

            <TouchableOpacity
              style={[styles.button, (isLoading || !code.trim() || !newPassword) && styles.buttonDisabled]}
              onPress={handleReset}
              disabled={isLoading || !code.trim() || !newPassword}
            >
              {isLoading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.buttonText}>{t('forgotPassword.submit')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.linkContainer} onPress={() => router.back()}>
          <Text style={styles.linkText}>{t('forgotPassword.backToLogin')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  logo: {
    fontSize: 60,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 16,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  sessionsWarning: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  linkContainer: {
    marginTop: SPACING.lg,
    alignItems: 'center',
  },
  linkText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
});
