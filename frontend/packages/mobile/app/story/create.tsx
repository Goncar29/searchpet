// ============================================================
// SearchPet - Create Success Story Screen
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useCreateStory } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

export default function CreateStoryScreen() {
  const router = useRouter();
  const { petId } = useLocalSearchParams<{ petId: string }>();
  const createStory = useCreateStory();
  const { t } = useTranslation('story');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bodyError, setBodyError] = useState('');

  const handleSubmit = () => {
    if (!body.trim()) {
      setBodyError(i18next.t('story:bodyRequired'));
      return;
    }
    setBodyError('');

    createStory.mutate(
      {
        pet_id: petId,
        title: title.trim() || undefined,
        body: body.trim(),
      },
      {
        onSuccess: () => {
          Alert.alert(i18next.t('story:successTitle'), i18next.t('story:successText'));
          router.back();
        },
        onError: (err: any) => {
          // error is shown inline — no Alert, stay on screen
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>{t('story:createTitle')}</Text>
        <Text style={styles.subtitle}>
          {t('story:createSubtitle')}
        </Text>

        {/* Historia (obligatoria) */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('story:historyLabel')} <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={[styles.textarea, bodyError ? styles.inputError : null]}
            placeholder={t('story:bodyPlaceholder')}
            placeholderTextColor={COLORS.placeholder}
            value={body}
            onChangeText={(text) => {
              setBody(text);
              if (text.trim()) setBodyError('');
            }}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
          {!!bodyError && <Text style={styles.errorText}>{bodyError}</Text>}
        </View>

        {/* Título (opcional) */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('story:titleLabel')} <Text style={styles.optional}>{t('story:optional')}</Text></Text>
          <TextInput
            style={styles.input}
            placeholder={t('story:titlePlaceholder')}
            placeholderTextColor={COLORS.placeholder}
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
          />
        </View>

        {/* Error de mutación */}
        {createStory.isError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>
              {(createStory.error as any)?.message || t('story:submitError')}
            </Text>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.button, createStory.isPending && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={createStory.isPending}
          activeOpacity={0.8}
        >
          {createStory.isPending ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.buttonText}>{t('story:submit')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => router.back()}
          disabled={createStory.isPending}
        >
          <Text style={styles.cancelButtonText}>{t('common:cancel')}</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
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
    padding: SPACING.lg,
  },
  emoji: {
    fontSize: 52,
    textAlign: 'center',
    marginTop: SPACING.lg,
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
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    lineHeight: 20,
  },
  fieldGroup: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  required: {
    color: COLORS.danger,
  },
  optional: {
    color: COLORS.textMuted,
    fontWeight: '400',
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
    ...SHADOWS.sm,
  },
  textarea: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    minHeight: 120,
    ...SHADOWS.sm,
  },
  inputError: {
    borderColor: COLORS.danger,
  },
  errorText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.danger,
    marginTop: SPACING.xs,
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorBannerText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.danger,
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
    ...SHADOWS.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  cancelButtonText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
});
