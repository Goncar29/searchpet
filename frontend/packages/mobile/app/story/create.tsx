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
import { getErrorMessage } from '../../../shared/utils/apiErrors';
import { SPACING, FONTS, RADIUS, SHADOWS, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { Icon } from '../../components/Icon';

export default function CreateStoryScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
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
        <View style={styles.emoji}><Icon name="celebration" size={52} color={colors.primary} /></View>
        <Text style={styles.subtitle}>
          {t('story:createSubtitle')}
        </Text>

        {/* Historia (obligatoria) */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('story:historyLabel')} <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={[styles.textarea, bodyError ? styles.inputError : null]}
            placeholder={t('story:bodyPlaceholder')}
            placeholderTextColor={colors.placeholder}
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
            placeholderTextColor={colors.placeholder}
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
          />
        </View>

        {/* Error de mutación */}
        {createStory.isError && (
          <View style={styles.errorBanner}>
            {/* Rule #11: never the raw `err.message` — resolved through
                getErrorMessage/i18next like every other mobile screen.
                fallbackKey keeps 'story:submitError' as the fallback for
                unmapped codes instead of the generic errors:unknown_error. */}
            <Text style={styles.errorBannerText}>
              {getErrorMessage(createStory.error, t, 'story:submitError')}
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
            <ActivityIndicator color={colors.onPrimary} />
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

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  content: {
    padding: SPACING.lg,
  },
  emoji: {
    alignItems: 'center',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
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
    color: c.textPrimary,
    marginBottom: SPACING.xs,
  },
  required: {
    color: c.danger,
  },
  optional: {
    color: c.textMuted,
    fontWeight: '400',
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
    ...SHADOWS.sm,
  },
  textarea: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: FONTS.sizes.md,
    color: c.textPrimary,
    minHeight: 120,
    ...SHADOWS.sm,
  },
  inputError: {
    borderColor: c.danger,
  },
  errorText: {
    fontSize: FONTS.sizes.xs,
    color: c.danger,
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
    color: c.danger,
  },
  button: {
    backgroundColor: c.primary,
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
    color: c.onPrimary,
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
    color: c.textSecondary,
    fontWeight: '500',
  },
});
