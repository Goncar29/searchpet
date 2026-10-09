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
  StyleSheet,
} from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useMyFosterHome, useRegisterFosterHome } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { AnimalKind, HousingType, RegisterFosterHomeRequest } from '@shared/types';
import { SPACING, FONTS, RADIUS, SHADOWS, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { VerifiedEmailGate } from '../../components/VerifiedEmailGate';
import { showAlert } from '../../components/appAlert';

const HOUSING_TYPES: HousingType[] = ['house', 'apartment'];
const ANIMAL_TYPES: AnimalKind[] = ['dog', 'cat', 'other'];

// Deben coincidir con los límites del backend (foster_home_dto.go) y el form web.
const CITY_MAX_LEN = 100;
const DESCRIPTION_MAX_LEN = 500;
const WHATSAPP_MAX_LEN = 20;

interface FieldErrors {
  city?: string;
  animalTypes?: string;
  capacity?: string;
  description?: string;
}

export default function RegisterFosterHomeScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);
  const router = useRouter();

  const { data: mine, isLoading: mineLoading } = useMyFosterHome();
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

  if (mineLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (mine) {
    // Redirect effect above will navigate away — render nothing meanwhile.
    return null;
  }

  const toggleAnimalType = (kind: AnimalKind) => {
    setAnimalTypes((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
    setErrors((prev) => ({ ...prev, animalTypes: undefined }));
  };

  const validate = (): boolean => {
    const nextErrors: FieldErrors = {};
    if (!city.trim()) nextErrors.city = t('fosterHomes:register.cityRequired');
    else if (city.length > CITY_MAX_LEN) {
      nextErrors.city = t('fosterHomes:register.maxLengthError', { max: CITY_MAX_LEN });
    }
    if (animalTypes.length === 0) nextErrors.animalTypes = t('fosterHomes:register.animalTypesRequired');
    const capacityNum = Number(capacity);
    if (!Number.isInteger(capacityNum) || capacityNum < 1) {
      nextErrors.capacity = t('fosterHomes:register.capacityInvalid');
    }
    if (!description.trim()) nextErrors.description = t('fosterHomes:register.descriptionRequired');
    else if (description.length > DESCRIPTION_MAX_LEN) {
      nextErrors.description = t('fosterHomes:register.maxLengthError', { max: DESCRIPTION_MAX_LEN });
    }
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
        showAlert(
          i18next.t('fosterHomes:register.successTitle'),
          i18next.t('fosterHomes:register.successBody'),
        );
        router.replace('/foster-homes/mine');
      },
      onError: (err: unknown) => {
        showAlert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
      },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>{t('fosterHomes:register.intro')}</Text>

      <VerifiedEmailGate
        unverifiedMessage={t('fosterHomes:register.emailUnverified')}
        verifyLabel={t('fosterHomes:register.verifyEmailLink')}
      >
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
            placeholderTextColor={colors.placeholder}
            autoCapitalize="words"
            maxLength={CITY_MAX_LEN}
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
            maxLength={DESCRIPTION_MAX_LEN}
          />
          <View style={styles.fieldFooter}>
            {errors.description ? (
              <Text style={styles.error}>{errors.description}</Text>
            ) : (
              <View />
            )}
            <Text style={styles.counter}>{description.length}/{DESCRIPTION_MAX_LEN}</Text>
          </View>
        </View>

        {/* WhatsApp (optional) */}
        <View style={styles.section}>
          <Text style={styles.label}>{t('fosterHomes:register.whatsapp')}</Text>
          <TextInput
            style={styles.input}
            value={whatsappPhone}
            onChangeText={setWhatsappPhone}
            keyboardType="phone-pad"
            maxLength={WHATSAPP_MAX_LEN}
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, registerFosterHome.isPending && styles.disabledButton]}
          onPress={handleSubmit}
          disabled={registerFosterHome.isPending}
          accessibilityRole="button"
        >
          {registerFosterHome.isPending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text style={styles.submitButtonText}>{t('fosterHomes:register.submit')}</Text>
          )}
        </TouchableOpacity>
      </VerifiedEmailGate>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: c.background,
  },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  intro: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    marginBottom: SPACING.lg,
    lineHeight: 20,
  },
  section: { marginBottom: SPACING.md },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: c.textPrimary,
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: c.textPrimary,
  },
  textArea: { height: 90, textAlignVertical: 'top' },
  error: { fontSize: FONTS.sizes.xs, color: c.danger, marginTop: SPACING.xs },
  fieldFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  counter: { fontSize: FONTS.sizes.xs, color: c.textMuted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chipOption: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: c.surface,
  },
  chipOptionActive: { borderColor: c.primary, backgroundColor: c.primaryLight + '22' },
  chipLabel: { fontSize: FONTS.sizes.sm, color: c.textSecondary, fontWeight: '600' },
  chipLabelActive: { color: c.primary },
  submitButton: {
    backgroundColor: c.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  disabledButton: { opacity: 0.6 },
  submitButtonText: { color: c.onPrimary, fontWeight: '700', fontSize: FONTS.sizes.md },
});
