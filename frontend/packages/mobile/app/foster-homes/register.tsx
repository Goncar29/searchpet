// ============================================================
// SearchPet — Foster Home Registration Screen
// Mirrors RegisterFosterHomePage.tsx (web): email-verification
// gate, redirect-if-already-owns-a-home, field-by-field validation.
// ============================================================

import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useMyFosterHome, useRegisterFosterHome, useVerificationStatus } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { AnimalKind, HousingType, RegisterFosterHomeRequest } from '@shared/types';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

const HOUSING_TYPES: HousingType[] = ['house', 'apartment'];
const ANIMAL_TYPES: AnimalKind[] = ['dog', 'cat', 'other'];

interface FieldErrors {
  city?: string;
  animalTypes?: string;
  capacity?: string;
  description?: string;
}

export default function RegisterFosterHomeScreen() {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);
  const router = useRouter();

  const { data: mine, isLoading: mineLoading } = useMyFosterHome();
  const { data: verification, isLoading: verificationLoading } = useVerificationStatus();
  const registerFosterHome = useRegisterFosterHome();

  const [city, setCity] = useState('');
  const [housingType, setHousingType] = useState<HousingType>('house');
  const [animalTypes, setAnimalTypes] = useState<AnimalKind[]>([]);
  const [capacity, setCapacity] = useState('1');
  const [description, setDescription] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  // Already owns a foster home — this screen doesn't apply, redirect to "mine".
  useEffect(() => {
    if (mine) {
      router.replace('/foster-homes/mine');
    }
  }, [mine, router]);

  if (mineLoading || verificationLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (mine) {
    // Redirect effect above will navigate away — render nothing meanwhile.
    return null;
  }

  const emailVerified = verification?.email_verified ?? false;

  const toggleAnimalType = (kind: AnimalKind) => {
    setAnimalTypes((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
    setErrors((prev) => ({ ...prev, animalTypes: undefined }));
  };

  const validate = (): boolean => {
    const nextErrors: FieldErrors = {};
    if (!city.trim()) nextErrors.city = t('fosterHomes:register.cityRequired');
    if (animalTypes.length === 0) nextErrors.animalTypes = t('fosterHomes:register.animalTypesRequired');
    const capacityNum = Number(capacity);
    if (!Number.isInteger(capacityNum) || capacityNum < 1) {
      nextErrors.capacity = t('fosterHomes:register.capacityInvalid');
    }
    if (!description.trim()) nextErrors.description = t('fosterHomes:register.descriptionRequired');
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    const payload: RegisterFosterHomeRequest = {
      city: city.trim(),
      housing_type: housingType,
      animal_types: animalTypes,
      capacity: Number(capacity),
      description: description.trim(),
      whatsapp_phone: whatsappPhone.trim() || undefined,
    };

    registerFosterHome.mutate(payload, {
      onSuccess: () => {
        Alert.alert(
          i18next.t('fosterHomes:register.successTitle'),
          i18next.t('fosterHomes:register.successBody'),
        );
        router.replace('/foster-homes/mine');
      },
      onError: (err: unknown) => {
        Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
      },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('fosterHomes:register.title')}</Text>
      <Text style={styles.intro}>{t('fosterHomes:register.intro')}</Text>

      {!emailVerified ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{t('fosterHomes:register.emailUnverified')}</Text>
          <TouchableOpacity
            style={styles.noticeButton}
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
          >
            <Text style={styles.noticeButtonText}>{t('fosterHomes:register.verifyEmailLink')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* City */}
          <View style={styles.section}>
            <Text style={styles.label}>{t('fosterHomes:register.city')}</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={(text) => {
                setCity(text);
                setErrors((prev) => ({ ...prev, city: undefined }));
              }}
              placeholderTextColor={COLORS.placeholder}
              autoCapitalize="words"
            />
            {errors.city && <Text style={styles.error}>{errors.city}</Text>}
          </View>

          {/* Housing type */}
          <View style={styles.section}>
            <Text style={styles.label}>{t('fosterHomes:register.housingType')}</Text>
            <View style={styles.chipRow}>
              {HOUSING_TYPES.map((ht) => {
                const active = housingType === ht;
                return (
                  <TouchableOpacity
                    key={ht}
                    style={[styles.chipOption, active && styles.chipOptionActive]}
                    onPress={() => setHousingType(ht)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                      {t(`fosterHomes:housingType.${ht}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Animal types */}
          <View style={styles.section}>
            <Text style={styles.label}>{t('fosterHomes:register.animalTypes')}</Text>
            <View style={styles.chipRow}>
              {ANIMAL_TYPES.map((kind) => {
                const active = animalTypes.includes(kind);
                return (
                  <TouchableOpacity
                    key={kind}
                    style={[styles.chipOption, active && styles.chipOptionActive]}
                    onPress={() => toggleAnimalType(kind)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                      {t(`fosterHomes:animalType.${kind}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {errors.animalTypes && <Text style={styles.error}>{errors.animalTypes}</Text>}
          </View>

          {/* Capacity */}
          <View style={styles.section}>
            <Text style={styles.label}>{t('fosterHomes:register.capacity')}</Text>
            <TextInput
              style={styles.input}
              value={capacity}
              onChangeText={(text) => {
                setCapacity(text);
                setErrors((prev) => ({ ...prev, capacity: undefined }));
              }}
              keyboardType="number-pad"
            />
            {errors.capacity && <Text style={styles.error}>{errors.capacity}</Text>}
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.label}>{t('fosterHomes:register.description')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={(text) => {
                setDescription(text);
                setErrors((prev) => ({ ...prev, description: undefined }));
              }}
              multiline
              numberOfLines={4}
            />
            {errors.description && <Text style={styles.error}>{errors.description}</Text>}
          </View>

          {/* WhatsApp (optional) */}
          <View style={styles.section}>
            <Text style={styles.label}>{t('fosterHomes:register.whatsapp')}</Text>
            <TextInput
              style={styles.input}
              value={whatsappPhone}
              onChangeText={setWhatsappPhone}
              keyboardType="phone-pad"
            />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, registerFosterHome.isPending && styles.disabledButton]}
            onPress={handleSubmit}
            disabled={registerFosterHome.isPending}
            accessibilityRole="button"
          >
            {registerFosterHome.isPending ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text style={styles.submitButtonText}>{t('fosterHomes:register.submit')}</Text>
            )}
          </TouchableOpacity>
        </>
      )}
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
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  intro: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
    lineHeight: 20,
  },
  noticeCard: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.warning,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  noticeText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  noticeButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
  },
  noticeButtonText: { color: COLORS.white, fontSize: FONTS.sizes.sm, fontWeight: '700' },
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chipOption: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.white,
  },
  chipOptionActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight + '22' },
  chipLabel: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, fontWeight: '600' },
  chipLabelActive: { color: COLORS.primary },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  disabledButton: { opacity: 0.6 },
  submitButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.md },
});
