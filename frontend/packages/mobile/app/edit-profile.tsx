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
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';

export default function EditProfileScreen() {
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
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backArrow}>
            <Text style={styles.backArrowText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('editProfile.title')}</Text>
        </View>

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
              placeholderTextColor={COLORS.placeholder}
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
              placeholderTextColor={COLORS.placeholder}
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
              placeholderTextColor={COLORS.placeholder}
            />
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveButton, isDisabled && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isDisabled}
          >
            {updateMe.isPending ? (
              <ActivityIndicator color={COLORS.white} />
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backArrow: {
    marginRight: SPACING.sm,
    padding: SPACING.xs,
  },
  backArrowText: {
    fontSize: 28,
    color: COLORS.primary,
    lineHeight: 32,
  },
  headerTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
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
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    ...SHADOWS.sm,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
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
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
});
