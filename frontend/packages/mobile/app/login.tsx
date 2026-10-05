// ============================================================
// SearchPet - Login Screen
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
import { useAuthStore } from '../store';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { SPACING, FONTS, RADIUS, GOOGLE_WEB_CLIENT_ID, type ThemeColors } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';

export default function LoginScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('auth');
  const login = useAuthStore((state) => state.login);
  const loginWithGoogle = useAuthStore((state) => state.loginWithGoogle);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert(i18next.t('common:error'), i18next.t('auth:login.fieldsRequired'));
      return;
    }

    setIsLoading(true);
    try {
      await login(email.trim(), password);
      router.back();
    } catch (error) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleToken = async (idToken: string) => {
    try {
      const isNewUser = await loginWithGoogle(idToken);
      // Un usuario nuevo llega sin ubicación y la búsqueda cercana es el punto de
      // la app. Uno que vuelve ya la tiene: mandarlo ahí sería repetirle un paso.
      if (isNewUser) {
        router.replace('/google-location');
      } else {
        router.back();
      }
    } catch (error) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <View style={styles.logo}><Logo size={64} /></View>
        <Text style={styles.title}>{t('login.welcome')}</Text>
        <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

        <TextInput
          style={styles.input}
          placeholder={t('login.email')}
          placeholderTextColor={colors.placeholder}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />

        <TextInput
          style={styles.input}
          placeholder={t('login.password')}
          placeholderTextColor={colors.placeholder}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{t('login.submit')}</Text>
          )}
        </TouchableOpacity>

        <GoogleSignInButton clientId={GOOGLE_WEB_CLIENT_ID} onToken={handleGoogleToken} />

        <TouchableOpacity
          style={styles.linkContainer}
          onPress={() => router.push('/forgot-password')}
        >
          <Text style={styles.linkText}>{t('forgotPassword.link')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkContainer}
          onPress={() => {
            router.back();
            router.push('/register');
          }}
        >
          <Text style={styles.linkText}>{t('login.noAccount')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
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
  input: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 16,
    fontSize: FONTS.sizes.md,
    color: c.textPrimary,
    marginBottom: SPACING.md,
  },
  button: {
    backgroundColor: c.primary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
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
