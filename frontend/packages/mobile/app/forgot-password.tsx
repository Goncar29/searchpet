// ============================================================
// SearchPet - Forgot Password Screen (two-step: request code, then reset)
// ============================================================

import { useEffect, useState } from 'react';
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

  // Sin storage: en React Native no hay localStorage, y un contador de 60s no
  // tiene por qué sobrevivir a la pantalla. Muere con el componente, que es la
  // vida útil correcta.
  //
  // Un deadline + un único setInterval, en vez de una cadena de setTimeout que se
  // reprograma sola: la cadena obliga a que cada tick corra dentro de su propio
  // act() en los tests, y el deadline además no se desfasa si el hilo de JS se
  // traba. Mismo criterio que la web.
  const [resendAt, setResendAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    // Sin deadline no hay nada que contar: arrancar el intervalo igual sería un
    // tick por segundo sin propósito, y en los tests dispara warnings de act()
    // por actualizar estado fuera de toda interacción.
    if (resendAt === 0) return;

    const tick = () => {
      const ms = resendAt - Date.now();
      setSecondsLeft(ms > 0 ? Math.ceil(ms / 1000) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  const handleRequestCode = async () => {
    setIsLoading(true);
    try {
      await apiClient.forgotPassword(email.trim());
      setResendAt(Date.now() + 60_000);
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

        {/* Texto FIJO: informa la POLÍTICA, nunca el estado de la cuenta. Un
            contador real sólo se puede calcular para una cuenta que existe, así
            que mostrarlo reconstruiría en el cliente el oráculo de enumeración
            que el backend cierra a propósito. */}
        {step === 'email' && (
          <Text style={styles.notice}>{t('forgotPassword.dailyLimitNotice')}</Text>
        )}

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

            {/* La cuenta regresiva sale del reloj del cliente: refleja lo que
                hizo ESTA pantalla, no lo que sabe el servidor. El servidor no
                puede informarla sin delatar si la cuenta existe. */}
            <TouchableOpacity
              onPress={handleRequestCode}
              disabled={secondsLeft > 0 || isLoading}
            >
              <Text style={[styles.resend, secondsLeft > 0 && styles.resendDisabled]}>
                {secondsLeft > 0
                  ? t('forgotPassword.resendIn', { seconds: secondsLeft })
                  : t('forgotPassword.resend')}
              </Text>
            </TouchableOpacity>

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
  notice: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  resend: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  resendDisabled: {
    color: COLORS.textMuted,
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
