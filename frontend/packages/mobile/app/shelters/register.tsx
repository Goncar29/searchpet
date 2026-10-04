// ============================================================
// SearchPet — Shelter Registration Screen
// Mirrors RegisterShelterPage.tsx (web): email-verification gate,
// redirect-if-already-owns-a-shelter, https-only links, pending-review
// confirmation. The backend creates the shelter `pending` for admin review.
// ============================================================

import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMyShelter, useRegisterShelter } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import { Icon } from '../../components/Icon';
import { VerifiedEmailGate } from '../../components/VerifiedEmailGate';

const HTTPS_RE = /^https:\/\/.+/;

type FormState = {
  name: string;
  city: string;
  phone: string;
  email: string;
  description: string;
  website_url: string;
  donation_url: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  city: '',
  phone: '',
  email: '',
  description: '',
  website_url: '',
  donation_url: '',
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

export default function RegisterShelterScreen() {
  const { t } = useTranslation(['shelters', 'errors', 'common']);
  const router = useRouter();

  const { data: myShelter, isLoading: myShelterLoading } = useMyShelter();
  const registerShelter = useRegisterShelter();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Already owns a shelter: this screen does not apply. GOTCHA: after a
  // successful submit the invalidation repopulates useMyShelter, so without the
  // `done` guard this redirect would eat the confirmation.
  useEffect(() => {
    if (myShelter && !done) router.replace('/shelters');
  }, [myShelter, done, router]);

  if (done) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.doneContent}>
        <Icon name="home" size={48} color={COLORS.primary} />
        <Text style={styles.doneTitle}>{t('shelters:register.successTitle')}</Text>
        <Text style={styles.doneBody}>{t('shelters:register.successBody')}</Text>
        <TouchableOpacity
          style={styles.submitButton}
          onPress={() => router.replace('/shelters')}
          accessibilityRole="button"
        >
          <Text style={styles.submitButtonText}>{t('shelters:register.goToList')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (myShelterLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (myShelter) {
    // The redirect effect navigates away — render nothing meanwhile.
    return null;
  }

  const setField = (key: keyof FormState) => (text: string) => {
    setForm((f) => ({ ...f, [key]: text }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (!form.name.trim()) next.name = t('shelters:register.nameRequired');
    if (!form.city.trim()) next.city = t('shelters:register.cityRequired');
    const website = form.website_url.trim();
    if (website && !HTTPS_RE.test(website)) next.website_url = t('shelters:register.invalidUrl');
    const donation = form.donation_url.trim();
    if (donation && !HTTPS_RE.test(donation)) next.donation_url = t('shelters:register.invalidUrl');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    setApiError(null);
    if (!validate()) return;
    registerShelter.mutate(
      {
        name: form.name.trim(),
        city: form.city.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        description: form.description.trim(),
        website_url: form.website_url.trim(),
        donation_url: form.donation_url.trim(),
      },
      {
        onSuccess: () => setDone(true),
        onError: (err: unknown) => setApiError(getErrorMessage(err, t)),
      },
    );
  };

  const field = (
    key: keyof FormState,
    label: string,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {},
  ) => (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, extra.multiline && styles.textArea]}
        value={form[key]}
        onChangeText={setField(key)}
        accessibilityLabel={label}
        placeholderTextColor={COLORS.placeholder}
        {...extra}
      />
      {errors[key] ? <Text style={styles.error}>{errors[key]}</Text> : null}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.note}>{t('shelters:register.reviewNote')}</Text>
      <Text style={styles.note}>{t('shelters:register.noMoneyNote')}</Text>
      <Text style={[styles.note, styles.lastNote]}>{t('shelters:register.oneShelterNote')}</Text>

      <VerifiedEmailGate
        unverifiedMessage={t('shelters:register.emailUnverified')}
        verifyLabel={t('shelters:register.verifyEmailLink')}
      >
        {field('name', t('shelters:register.name'), { autoCapitalize: 'words' })}
        {field('city', t('shelters:register.city'), { autoCapitalize: 'words' })}
        {field('phone', t('shelters:register.phone'), { keyboardType: 'phone-pad' })}
        {field('email', t('shelters:register.email'), { keyboardType: 'email-address', autoCapitalize: 'none' })}
        {field('description', t('shelters:register.description'), {
          multiline: true,
          numberOfLines: 4,
        })}
        {field('website_url', t('shelters:register.websiteUrl'), { keyboardType: 'url', autoCapitalize: 'none' })}
        {field('donation_url', t('shelters:register.donationUrl'), { keyboardType: 'url', autoCapitalize: 'none' })}

        {apiError ? (
          <Text style={styles.error} accessibilityRole="alert">
            {apiError}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.submitButton, registerShelter.isPending && styles.disabledButton]}
          onPress={handleSubmit}
          disabled={registerShelter.isPending}
          accessibilityRole="button"
        >
          {registerShelter.isPending ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text style={styles.submitButtonText}>{t('shelters:register.submit')}</Text>
          )}
        </TouchableOpacity>
      </VerifiedEmailGate>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  doneContent: { padding: SPACING.lg, paddingTop: SPACING.xxl, alignItems: 'center' },
  doneTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  doneBody: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  note: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
    lineHeight: 20,
  },
  lastNote: { marginBottom: SPACING.lg },
  section: { marginBottom: SPACING.md },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  textArea: { height: 90, textAlignVertical: 'top' },
  error: { fontSize: FONTS.sizes.xs, color: COLORS.danger, marginTop: SPACING.xs },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  disabledButton: { opacity: 0.6 },
  submitButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.md },
});
