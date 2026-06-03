// ============================================================
// SearchPet - Register Screen
// ============================================================

import { useState } from 'react';
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
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useAuthStore } from '../store';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';

export default function RegisterScreen() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const register = useAuthStore((state) => state.register);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert(i18next.t('common:error'), i18next.t('auth:register.requiredFields'));
      return;
    }

    if (password.length < 6) {
      Alert.alert(i18next.t('common:error'), i18next.t('auth:register.passwordMin'));
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(i18next.t('common:error'), i18next.t('auth:register.passwordMismatch'));
      return;
    }

    setIsLoading(true);
    try {
      await register(email.trim(), password, name.trim(), phone.trim() || undefined, city.trim() || undefined);
      Alert.alert(i18next.t('auth:register.createdTitle'), i18next.t('auth:register.createdMessage'), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error: any) {
      Alert.alert(i18next.t('common:error'), error.message || i18next.t('auth:register.createError'));
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
        <Text style={styles.logo}>🐾</Text>
        <Text style={styles.title}>{t('register.title')}</Text>
        <Text style={styles.subtitle}>{t('register.subtitle')}</Text>

        <Text style={styles.label}>{t('register.nameLabelRequired')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.name')}
          placeholderTextColor={COLORS.placeholder}
          value={name}
          onChangeText={setName}
          autoComplete="name"
        />

        <Text style={styles.label}>{t('register.emailLabelRequired')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.emailPlaceholder')}
          placeholderTextColor={COLORS.placeholder}
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
          placeholderTextColor={COLORS.placeholder}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
        />

        <Text style={styles.label}>{t('register.city')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.cityPlaceholder')}
          placeholderTextColor={COLORS.placeholder}
          value={city}
          onChangeText={setCity}
          autoComplete="address-line1"
        />

        <Text style={styles.label}>{t('register.passwordLabelRequired')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.passwordPlaceholder')}
          placeholderTextColor={COLORS.placeholder}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Text style={styles.label}>{t('register.confirmLabelRequired')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('register.confirm')}
          placeholderTextColor={COLORS.placeholder}
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
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.buttonText}>{t('register.submit')}</Text>
          )}
        </TouchableOpacity>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.xl,
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
  linkBold: {
    color: COLORS.primary,
    fontWeight: '700',
  },
});
