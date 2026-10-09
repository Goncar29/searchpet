// ============================================================
// SearchPet - Register Screen
// ============================================================

import { useState } from 'react';
import { Logo } from '../components/Logo';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useAuthStore } from '../store';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { SPACING, FONTS, RADIUS, GOOGLE_WEB_CLIENT_ID, type ThemeColors } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';
import { showAlert } from '../components/appAlert';

export default function RegisterScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('auth');
  const register = useAuthStore((state) => state.register);
  const loginWithGoogle = useAuthStore((state) => state.loginWithGoogle);

  const handleGoogleToken = async (idToken: string) => {
    try {
      // Si la cuenta ya existía, el backend la vincula y devuelve is_new_user=false.
      // Llegar acá desde "Registrarse" con una cuenta existente no es un error.
      const isNewUser = await loginWithGoogle(idToken);
      if (isNewUser) {
        router.replace('/google-location');
      } else {
        router.back();
      }
    } catch (error) {
      showAlert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    }
  };

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password || !city.trim()) {
      showAlert(i18next.t('common:error'), i18next.t('auth:register.requiredFields'));
      return;
    }

    if (password.length < 6) {
      showAlert(i18next.t('common:error'), i18next.t('auth:register.passwordMin'));
      return;
    }

    if (password !== confirmPassword) {
      showAlert(i18next.t('common:error'), i18next.t('auth:register.passwordMismatch'));
      return;
    }

    setIsLoading(true);
    try {
      await register(email.trim(), password, name.trim(), phone.trim() || undefined, city.trim());
      showAlert(i18next.t('auth:register.createdTitle'), i18next.t('auth:register.createdMessage'), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      showAlert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.logo}><Logo size={64} /></View>
        <Text style={styles.title}>{t('register.title')}</Text>
        <Text style={styles.subtitle}>{t('register.subtitle')}</Text>

        <Text style={styles.label}>{t('register.nameLabelRequired')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.name')}
          placeholderTextColor={colors.placeholder}
          value={name}
          onChangeText={setName}
          autoComplete="name"
        />

        <Text style={styles.label}>{t('register.emailLabelRequired')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.emailPlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />

        <Text style={styles.label}>{t('register.phone')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.phonePlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
        />

        <Text style={styles.label}>{t('register.cityLabelRequired')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.cityPlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={city}
          onChangeText={setCity}
          autoComplete="address-line1"
        />

        <Text style={styles.label}>{t('register.passwordLabelRequired')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.passwordPlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Text style={styles.label}>{t('register.confirmLabelRequired')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.confirm')}
          placeholderTextColor={colors.placeholder}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{t('register.submit')}</Text>
          )}
        </TouchableOpacity>

        <GoogleSignInButton clientId={GOOGLE_WEB_CLIENT_ID} onToken={handleGoogleToken} />

        <TouchableOpacity
          style={styles.linkContainer}
          onPress={() => {
            router.back();
            router.push('/login');
          }}
        >
          <Text style={styles.linkText}>{t('register.hasAccount')}</Text>
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  content: {
    padding: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  logo: {
    fontSize: 50,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  title: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '700',
    color: c.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: c.textPrimary,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  input: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: FONTS.sizes.md,
    color: c.textPrimary,
  },
  button: {
    backgroundColor: c.primary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  linkContainer: {
    marginTop: SPACING.lg,
    alignItems: 'center',
  },
  linkText: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
  },
  linkBold: {
    color: c.primary,
    fontWeight: '700',
  },
});
