// ============================================================
// SearchPet - Register Pet Screen (owned-pet registration)
// Extracted from the old (tabs)/post.tsx — used by My Pets'
// "Registrar mascota" button. NOT part of the publish wizard
// (design decision 1: publish only publishes; registration
// stays here).
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as ImagePicker from 'expo-image-picker';
import { useCreatePet, useUploadPhotoNative } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { useAuthStore } from '../../store';
import { COLORS, SPACING, FONTS, RADIUS, PET_TYPES } from '../../constants';
import type { PetType } from '../../../shared/types';

export default function RegisterPetScreen() {
  const router = useRouter();
  const { t } = useTranslation(['post', 'pets', 'common']);
  const { isAuthenticated } = useAuthStore();
  const createPet = useCreatePet();
  const uploadPhoto = useUploadPhotoNative();

  const [name, setName] = useState('');
  const [type, setType] = useState<PetType>('perro');
  const [breed, setBreed] = useState('');
  const [color, setColor] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoErrors, setPhotoErrors] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isAuthenticated) {
    return (
      <View style={styles.authRequired}>
        <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>🔒</Text>
        <Text style={styles.authTitle}>{t('post:authRequired')}</Text>
        <Text style={styles.authText}>{t('post:authText')}</Text>
        <TouchableOpacity
          style={styles.authButton}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.authButtonText}>{t('post:loginButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/register')}>
          <Text style={styles.registerLink}>{t('post:registerLink')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const atLimit = photos.length >= 3;

  const pickImage = async () => {
    if (atLimit) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotos([...photos, result.assets[0].uri]);
    }
  };

  const takePhoto = async () => {
    if (atLimit) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(i18next.t('post:cameraPermission'), i18next.t('post:cameraPermissionText'));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotos([...photos, result.assets[0].uri]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
    setPhotoErrors((prev) => { const n = { ...prev }; delete n[index]; return n; });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert(i18next.t('common:error'), i18next.t('post:errorNameRequired'));
      return;
    }

    setIsSubmitting(true);
    setPhotoErrors({});
    try {
      // 1. Crear la mascota (status omitido => 'registered' por default del backend)
      const pet = await createPet.mutateAsync({
        name: name.trim(),
        type,
        breed: breed.trim(),
        color: color.trim(),
        description: description.trim(),
      });

      // 2. Subir fotos (no bloquea si falla — la mascota ya fue creada)
      const errors: Record<number, string> = {};
      for (let i = 0; i < photos.length; i++) {
        try {
          await uploadPhoto.mutateAsync({ petId: pet.id, uri: photos[i] });
        } catch (err) {
          errors[i] = getErrorMessage(err, (key) => i18next.t(key));
        }
      }
      setPhotoErrors(errors);

      const failCount = Object.keys(errors).length;
      let alertMessage = i18next.t('post:successMessage', { name });
      if (photos.length > 0 && failCount === photos.length) {
        alertMessage += i18next.t('post:photoUploadFail');
      } else if (failCount > 0) {
        alertMessage += i18next.t('post:photoPartialFail', { count: failCount });
      }

      Alert.alert(
        i18next.t('post:successTitle'),
        alertMessage,
        [{ text: 'OK', onPress: () => router.push('/my-pets') }]
      );

      setName('');
      setBreed('');
      setColor('');
      setDescription('');
      setPhotos([]);
    } catch (error) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>{t('post:title')}</Text>

        <Text style={styles.label}>{t('post:photos')} ({photos.length}/3)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
          {photos.map((uri, i) => (
            <TouchableOpacity key={i} onPress={() => removePhoto(i)}>
              <Image source={{ uri }} style={styles.photoThumb} />
              <View style={styles.photoRemove}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
              </View>
              {photoErrors[i] && (
                <View style={styles.photoErrorOverlay}>
                  <Text style={styles.photoErrorIcon}>⚠</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]} onPress={pickImage} disabled={atLimit}>
            <Text style={{ fontSize: 28, color: COLORS.textMuted }}>+</Text>
            <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{t('post:gallery')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]} onPress={takePhoto} disabled={atLimit}>
            <Text style={{ fontSize: 28, color: COLORS.textMuted }}>📷</Text>
            <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{t('post:camera')}</Text>
          </TouchableOpacity>
        </ScrollView>
        {atLimit && <Text style={styles.photoLimitText}>{t('post:photoLimit')}</Text>}

        <Text style={styles.label}>{t('post:nameLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('post:namePlaceholder')} placeholderTextColor={COLORS.placeholder} value={name} onChangeText={setName} />

        <Text style={styles.label}>{t('post:typeLabel')}</Text>
        <View style={styles.typeRow}>
          {PET_TYPES.map((petType) => (
            <TouchableOpacity
              key={petType.value}
              style={[styles.typeButton, type === petType.value && styles.typeButtonActive]}
              onPress={() => setType(petType.value as PetType)}
            >
              <Text style={{ fontSize: 20 }}>{petType.icon}</Text>
              <Text style={[styles.typeLabel, type === petType.value && styles.typeLabelActive]}>
                {t(`pets:types.${petType.value}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('post:breedLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('post:breedPlaceholder')} placeholderTextColor={COLORS.placeholder} value={breed} onChangeText={setBreed} />

        <Text style={styles.label}>{t('post:colorLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('post:colorPlaceholder')} placeholderTextColor={COLORS.placeholder} value={color} onChangeText={setColor} />

        <Text style={styles.label}>{t('post:descriptionLabel')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder={t('post:descriptionPlaceholder')}
          placeholderTextColor={COLORS.placeholder}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <TouchableOpacity style={[styles.submitButton, isSubmitting && styles.submitDisabled]} onPress={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.submitText}>{t('post:submit')}</Text>}
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg },
  sectionTitle: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.lg },
  label: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.xs, marginTop: SPACING.md },
  input: {
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: 14, fontSize: FONTS.sizes.md, color: COLORS.textPrimary,
  },
  textArea: { minHeight: 100, paddingTop: 14 },
  photoRow: { flexDirection: 'row', marginVertical: SPACING.sm },
  photoThumb: { width: 80, height: 80, borderRadius: RADIUS.md, marginRight: SPACING.sm },
  photoRemove: { position: 'absolute', top: -4, right: 4, backgroundColor: COLORS.danger, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  photoErrorOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, top: 0, borderRadius: RADIUS.md, backgroundColor: 'rgba(200, 0, 0, 0.45)', justifyContent: 'center', alignItems: 'center' },
  photoErrorIcon: { fontSize: 22, color: '#fff' },
  addPhoto: { width: 80, height: 80, borderRadius: RADIUS.md, borderWidth: 2, borderColor: COLORS.border, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginRight: SPACING.sm },
  addPhotoDisabled: { opacity: 0.4 },
  photoLimitText: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: SPACING.xs, marginBottom: SPACING.xs },
  typeRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  typeButton: { flex: 1, alignItems: 'center', padding: SPACING.md, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md },
  typeButtonActive: { borderColor: COLORS.primary, backgroundColor: '#FFF0E8' },
  typeLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 4, fontWeight: '500' },
  typeLabelActive: { color: COLORS.primary, fontWeight: '700' },
  submitButton: { backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: RADIUS.md, alignItems: 'center', marginTop: SPACING.xl },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },
  authRequired: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
    backgroundColor: COLORS.background,
  },
  authTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  authText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  authButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
  },
  authButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  registerLink: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
});
