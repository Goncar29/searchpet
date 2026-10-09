import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PetIdentityFields } from '../PetIdentityFields';
import { composeBirthDate } from '@shared/utils/petBirthDate';
import * as ImagePicker from 'expo-image-picker';
import type { AdoptionFormState } from '../../app/(tabs)/post';
import { type ThemeColors, SPACING, FONTS, RADIUS, PET_TYPES } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { Icon } from '../Icon';
import { showAlert } from '../appAlert';

interface AdoptionFormStepProps {
  value: AdoptionFormState;
  onChange: (value: AdoptionFormState) => void;
  onSubmit: () => void;
  isPending: boolean;
}

const MAX_PHOTOS = 3;

interface FieldErrors {
  birthDate?: string;
  photo?: string;
  type?: string;
  city?: string;
}

// Mirrors StrayFormStep.tsx's shape (photos + type + breed + color + description),
// minus the location step, plus a required `city` field — adoption pets are
// owner-based and have no location report.
export function AdoptionFormStep({ value, onChange, onSubmit, isPending }: AdoptionFormStepProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [errors, setErrors] = useState<FieldErrors>({});

  const atLimit = value.photos.length >= MAX_PHOTOS;

  const pickFromGallery = async () => {
    if (atLimit) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      onChange({ ...value, photos: [...value.photos, result.assets[0].uri] });
      setErrors((prev) => ({ ...prev, photo: undefined }));
    }
  };

  const takePhoto = async () => {
    if (atLimit) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showAlert(t('publish:strayForm.cameraPermission'), t('publish:strayForm.cameraPermissionText'));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      onChange({ ...value, photos: [...value.photos, result.assets[0].uri] });
      setErrors((prev) => ({ ...prev, photo: undefined }));
    }
  };

  const removePhoto = (index: number) => {
    onChange({ ...value, photos: value.photos.filter((_, i) => i !== index) });
  };

  const handleSubmit = () => {
    const nextErrors: FieldErrors = {};
    if (value.photos.length === 0) nextErrors.photo = t('publish:strayForm.photoRequired');
    if (!value.type) nextErrors.type = t('publish:strayForm.typeRequired');
    if (!value.city.trim()) nextErrors.city = t('adoption:publish.cityRequired');
    // Acá hace más falta que en web: allá los meses y días salen de un <select>
    // acotado, así que "13" o "31 de febrero" NO se pueden elegir. Mobile los
    // pide en texto libre, o sea que la garantía estructural no existe y la
    // validación tiene que hacer todo el trabajo. Sin esto, escribir mes 13
    // creaba la mascota SIN fecha y sin un solo mensaje.
    if (value.identity.birth.year && !composeBirthDate(value.identity.birth)) {
      nextErrors.birthDate = t('pets:create.birthDateInvalid');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onSubmit();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('adoption:publish.title')}</Text>

      {/* Photos */}
      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{t('publish:strayForm.photoLabel')}</Text>
          <Text style={styles.photoCount}>{value.photos.length}/{MAX_PHOTOS}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
          {value.photos.map((uri, i) => (
            <TouchableOpacity key={`${uri}-${i}`} onPress={() => removePhoto(i)} accessibilityRole="button" accessibilityLabel={t('publish:strayForm.removePhoto')}>
              <Image source={{ uri }} style={styles.photoThumb} />
              <View style={styles.photoRemove}>
                <Icon name="close" size={14} color={colors.white} />
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]}
            onPress={pickFromGallery}
            disabled={atLimit}
            accessibilityRole="button"
          >
            <Text style={styles.addPhotoIcon}>+</Text>
            <Text style={styles.addPhotoLabel}>{t('publish:strayForm.gallery')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]}
            onPress={takePhoto}
            disabled={atLimit}
            accessibilityRole="button"
          >
            <Icon name="photo-camera" size={24} color={colors.textMuted} />
            <Text style={styles.addPhotoLabel}>{t('publish:strayForm.camera')}</Text>
          </TouchableOpacity>
        </ScrollView>
        {atLimit && <Text style={styles.hint}>{t('publish:strayForm.photoLimit')}</Text>}
        {errors.photo && <Text style={styles.error}>{errors.photo}</Text>}
      </View>

      {/* Type */}
      <View style={styles.section}>
        {/* Ver StrayFormStep: el asterisco sale de la traduccion compartida y se
            escribe aca, porque en la web FormField agrega el suyo y salian dos. */}
        <Text style={styles.label}>{t('publish:strayForm.typeLabel')} *</Text>
        <View style={styles.typeRow}>
          {PET_TYPES.map((petType) => {
            const active = value.type === petType.value;
            return (
              <TouchableOpacity
                key={petType.value}
                style={[styles.typeOption, active && styles.typeOptionActive]}
                onPress={() => {
                  onChange({ ...value, type: petType.value });
                  setErrors((prev) => ({ ...prev, type: undefined }));
                }}
                accessibilityRole="button"
              >
                <View style={styles.typeIcon}>
                  <Icon
                    name={petType.icon}
                    size={18}
                    color={active ? colors.primary : colors.textSecondary}
                  />
                </View>
                <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>
                  {t(`pets:types.${petType.value}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {errors.type && <Text style={styles.error}>{errors.type}</Text>}
      </View>

      <PetIdentityFields
        value={value.identity}
        onChange={(identity) => {
          onChange({ ...value, identity });
          setErrors((prev) => ({ ...prev, birthDate: undefined }));
        }}
        disabled={isPending}
        birthDateError={errors.birthDate}
      />

      {/* Breed */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('publish:strayForm.breedLabel')}</Text>
        <TextInput
          style={styles.input}
          value={value.breed}
          onChangeText={(text) => onChange({ ...value, breed: text })}
        />
      </View>

      {/* Color */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('publish:strayForm.colorLabel')}</Text>
        <TextInput
          style={styles.input}
          value={value.color}
          onChangeText={(text) => onChange({ ...value, color: text })}
        />
      </View>

      {/* Description */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('publish:strayForm.descriptionLabel')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={value.description}
          onChangeText={(text) => onChange({ ...value, description: text })}
          multiline
          numberOfLines={3}
        />
      </View>

      {/* City — required. Adoption pets are owner-based (no location report),
          so the city is how adopters filter/find them. */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('adoption:publish.cityLabel')}</Text>
        <TextInput
          style={styles.input}
          value={value.city}
          onChangeText={(text) => onChange({ ...value, city: text })}
          placeholder={t('adoption:publish.cityPlaceholder')}
          placeholderTextColor={colors.placeholder}
        />
        {errors.city && <Text style={styles.error}>{errors.city}</Text>}
      </View>

      <TouchableOpacity
        style={[styles.nextButton, isPending && styles.disabled]}
        onPress={handleSubmit}
        disabled={isPending}
        accessibilityRole="button"
      >
        <Text style={styles.nextButtonText}>{t('adoption:publish.submit')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  container: { backgroundColor: c.surface, borderRadius: RADIUS.lg, padding: SPACING.lg },
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: c.textPrimary, marginBottom: SPACING.lg, textAlign: 'center' },
  section: { marginBottom: SPACING.md },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xs },
  label: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: c.textPrimary, marginBottom: SPACING.xs },
  photoCount: { fontSize: FONTS.sizes.xs, color: c.textMuted },
  photoRow: { flexDirection: 'row' },
  photoThumb: { width: 72, height: 72, borderRadius: RADIUS.md, marginRight: SPACING.sm },
  photoRemove: {
    position: 'absolute',
    top: -4,
    right: SPACING.sm - 4,
    width: 20,
    height: 20,
    borderRadius: RADIUS.full,
    backgroundColor: c.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhoto: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  addPhotoDisabled: { opacity: 0.4 },
  addPhotoIcon: { fontSize: 24, color: c.textMuted },
  addPhotoLabel: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  hint: { fontSize: FONTS.sizes.xs, color: c.textMuted, marginTop: SPACING.xs },
  error: { fontSize: FONTS.sizes.xs, color: c.danger, marginTop: SPACING.xs },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  typeOptionActive: { borderColor: c.primary, backgroundColor: c.primaryLight + '22' },
  typeIcon: { marginRight: SPACING.xs },
  typeLabel: { fontSize: FONTS.sizes.sm, color: c.textSecondary },
  typeLabelActive: { color: c.primary, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: c.textPrimary,
  },
  textArea: { height: 80, textAlignVertical: 'top' },
  nextButton: {
    backgroundColor: c.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  disabled: { opacity: 0.6 },
  nextButtonText: { color: c.onPrimary, fontWeight: '700', fontSize: FONTS.sizes.md },
});
