import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ScrollView, Alert, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import type { StrayFormState } from '../../app/(tabs)/post';
import { COLORS, SPACING, FONTS, RADIUS, PET_TYPES } from '../../constants';

interface StrayFormStepProps {
  value: StrayFormState;
  onChange: (value: StrayFormState) => void;
  onNext: () => void;
}

const MAX_PHOTOS = 3;

interface FieldErrors {
  photo?: string;
  type?: string;
}

export function StrayFormStep({ value, onChange, onNext }: StrayFormStepProps) {
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
      Alert.alert(t('publish:strayForm.cameraPermission'), t('publish:strayForm.cameraPermissionText'));
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

  const handleNext = () => {
    const nextErrors: FieldErrors = {};
    if (value.photos.length === 0) nextErrors.photo = t('publish:strayForm.photoRequired');
    if (!value.type) nextErrors.type = t('publish:strayForm.typeRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onNext();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('publish:strayForm.title')}</Text>

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
                <Text style={styles.photoRemoveText}>✕</Text>
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
            <Text style={styles.addPhotoIcon}>📷</Text>
            <Text style={styles.addPhotoLabel}>{t('publish:strayForm.camera')}</Text>
          </TouchableOpacity>
        </ScrollView>
        {atLimit && <Text style={styles.hint}>{t('publish:strayForm.photoLimit')}</Text>}
        {errors.photo && <Text style={styles.error}>{errors.photo}</Text>}
      </View>

      {/* Type */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('publish:strayForm.typeLabel')}</Text>
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
                <Text style={styles.typeIcon}>{petType.icon}</Text>
                <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>
                  {t(`pets:types.${petType.value}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {errors.type && <Text style={styles.error}>{errors.type}</Text>}
      </View>

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

      <TouchableOpacity style={styles.nextButton} onPress={handleNext} accessibilityRole="button">
        <Text style={styles.nextButtonText}>{t('publish:strayForm.next')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg },
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.lg, textAlign: 'center' },
  section: { marginBottom: SPACING.md },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xs },
  label: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.xs },
  photoCount: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted },
  photoRow: { flexDirection: 'row' },
  photoThumb: { width: 72, height: 72, borderRadius: RADIUS.md, marginRight: SPACING.sm },
  photoRemove: {
    position: 'absolute',
    top: -4,
    right: SPACING.sm - 4,
    width: 20,
    height: 20,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  addPhoto: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  addPhotoDisabled: { opacity: 0.4 },
  addPhotoIcon: { fontSize: 24, color: COLORS.textMuted },
  addPhotoLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  hint: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: SPACING.xs },
  error: { fontSize: FONTS.sizes.xs, color: COLORS.danger, marginTop: SPACING.xs },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  typeOptionActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight + '22' },
  typeIcon: { fontSize: FONTS.sizes.md, marginRight: SPACING.xs },
  typeLabel: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  typeLabelActive: { color: COLORS.primary, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  textArea: { height: 80, textAlignVertical: 'top' },
  nextButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  nextButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.md },
});
