// ============================================================
// SearchPet - Inline Auth Step (publish wizard, guest stray path)
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';

interface InlineAuthStepProps {
  onAuthenticated: () => void;
}

export function InlineAuthStep({ onAuthenticated }: InlineAuthStepProps) {
  const { t } = useTranslation();
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);

    if (tab === 'register' && !name.trim()) {
      setError(t('common:required'));
      return;
    }
    if (!email.trim() || !password) {
      setError(t('auth:login.fieldsRequired'));
      return;
    }

    setIsLoading(true);
    try {
      if (tab === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, name.trim());
      }
      onAuthenticated();
    } catch (err) {
      setError(getErrorMessage(err, (key) => t(key)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View>
      <Text style={styles.title}>{t('publish:auth.title')}</Text>
      <Text style={styles.description}>{t('publish:auth.description')}</Text>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === 'login' && styles.tabActive]}
          onPress={() => setTab('login')}
        >
          <Text style={[styles.tabText, tab === 'login' && styles.tabTextActive]}>
            {t('publish:auth.loginTab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'register' && styles.tabActive]}
          onPress={() => setTab('register')}
        >
          <Text style={[styles.tabText, tab === 'register' && styles.tabTextActive]}>
            {t('publish:auth.registerTab')}
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'register' && (
        <TextInput
          style={styles.input}
          placeholder={t('auth:register.name')}
          placeholderTextColor={COLORS.placeholder}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
      )}

      <TextInput
        style={styles.input}
        placeholder={t(tab === 'login' ? 'auth:login.email' : 'auth:register.email')}
        placeholderTextColor={COLORS.placeholder}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />

      <TextInput
        style={styles.input}
        placeholder={t(tab === 'login' ? 'auth:login.password' : 'auth:register.password')}
        placeholderTextColor={COLORS.placeholder}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.buttonText}>{t('publish:auth.continue')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  description: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  tabRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  tabTextActive: { color: COLORS.white },
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
  error: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.danger,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
});
