// ============================================================
// SearchPet — Edit Profile Screen
// Allows authenticated users to update their name, phone, city.
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../store';
import { useUpdateMe } from '../../shared/hooks';
import { SPACING, FONTS, RADIUS, SHADOWS, type ThemeColors } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';

export default function EditProfileScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('profile');
  const router = useRouter();

  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [city, setCity] = useState(user?.city ?? '');

  const updateMe = useUpdateMe();

  const handleSave = async () => {
    try {
      const updatedUser = await updateMe.mutateAsync({
        name: name.trim(),
        phone: phone.trim(),
        city: city.trim(),
      });
      await setUser(updatedUser);
      router.back();
    } catch {
      Alert.alert(t('editProfile.error'));
    }
  };

  const isDisabled = updateMe.isPending || name.trim() === '';

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('editProfile.name')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              returnKeyType="next"
              placeholderTextColor={colors.placeholder}
            />
          </View>

          {/* Phone */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('editProfile.phone')}</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              returnKeyType="next"
              placeholderTextColor={colors.placeholder}
            />
          </View>

          {/* City */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('editProfile.city')}</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={!isDisabled ? handleSave : undefined}
              placeholderTextColor={colors.placeholder}
            />
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveButton, isDisabled && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isDisabled}
          >
            {updateMe.isPending ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.saveButtonText}>
                {updateMe.isPending ? t('editProfile.saving') : t('editProfile.save')}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: c.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  fieldGroup: {
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: c.textSecondary,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: c.textPrimary,
    ...SHADOWS.sm,
  },
  saveButton: {
    backgroundColor: c.primary,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.md,
    ...SHADOWS.md,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
});
