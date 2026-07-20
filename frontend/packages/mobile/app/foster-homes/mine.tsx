// ============================================================
// SearchPet — My Foster Home Screen (edit + photos)
// Mirrors MyFosterHomePage.tsx (web): moderation status banner,
// editable form (frozen when suspended), photo management.
// ============================================================

import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as ImagePicker from 'expo-image-picker';
import {
  useMyFosterHome,
  useUpdateMyFosterHome,
  useUploadFosterHomePhoto,
  useDeleteFosterHomePhoto,
} from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type {
  AnimalKind,
  FosterHomePhoto,
  FosterHomeStatus,
  HousingType,
  UpdateMyFosterHomeRequest,
} from '@shared/types';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

const HOUSING_TYPES: HousingType[] = ['house', 'apartment'];
const ANIMAL_TYPES: AnimalKind[] = ['dog', 'cat', 'other'];
const MAX_PHOTOS = 5;

// status → key of the message in fosterHomes:mine.* (mirrors the status
// label, which uses fosterHomes:status.<status> directly).
const STATUS_MESSAGE_KEY: Record<FosterHomeStatus, string> = {
  pending: 'fosterHomes:mine.statusPending',
  approved: 'fosterHomes:mine.statusApproved',
  rejected: 'fosterHomes:mine.statusRejected',
  suspended: 'fosterHomes:mine.statusSuspended',
};

const STATUS_COLORS: Record<FosterHomeStatus, string> = {
  pending: COLORS.warning,
  approved: COLORS.success,
  rejected: COLORS.danger,
  suspended: COLORS.danger,
};

interface FieldErrors {
  city?: string;
  animalTypes?: string;
  capacity?: string;
  description?: string;
}

// Builds the RN "file" shape that FormData understands from an
// expo-image-picker URI — same construction as apiClient.uploadPhotoNative /
// uploadProfilePhotoNative, but cast to `File` here because
// uploadFosterHomePhoto(file: File) has no RN-specific variant.
function buildRNFile(uri: string): File {
  const filename = uri.split('/').pop() || 'photo.jpg';
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { uri, name: filename, type: mimeType } as unknown as File;
}

export default function MyFosterHomeScreen() {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);
  const router = useRouter();

  const { data: mine, error, isLoading, isError, refetch } = useMyFosterHome();
  const updateFosterHome = useUpdateMyFosterHome();
  const uploadPhoto = useUploadFosterHomePhoto();
  const deletePhoto = useDeleteFosterHomePhoto();

  const [city, setCity] = useState('');
  const [housingType, setHousingType] = useState<HousingType>('house');
  const [animalTypes, setAnimalTypes] = useState<AnimalKind[]>([]);
  const [capacity, setCapacity] = useState('1');
  const [description, setDescription] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);

  // Prefill the edit form once the foster home data arrives.
  useEffect(() => {
    if (mine) {
      setCity(mine.city);
      setHousingType(mine.housing_type);
      setAnimalTypes(mine.animal_types);
      setCapacity(String(mine.capacity));
      setDescription(mine.description ?? '');
      setWhatsappPhone(mine.whatsapp_phone ?? '');
    }
  }, [mine]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // 404 foster_home_not_found = user hasn't registered yet — NOT an error.
  const errorCode = (error as { code?: string } | null | undefined)?.code;
  if (isError && errorCode === 'foster_home_not_found') {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48 }}>🏠</Text>
        <Text style={styles.emptyTitle}>{t('fosterHomes:mine.noFosterHomeTitle')}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/foster-homes/register')}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{t('fosterHomes:mine.registerNow')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isError || !mine) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadErrorText}>{t('fosterHomes:mine.loadError')}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()} accessibilityRole="button">
          <Text style={styles.retryButtonText}>{t('fosterHomes:mine.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Explicit local typing for `status`/`photos`: on this package's TS config
  // (expo's classic "node" moduleResolution), react-query's generics don't
  // always propagate through `useQuery<TData, TError>` cleanly, which widens
  // `mine.status`/`mine.photos` to `any` at some call sites (same root cause
  // as the pre-existing baseline tsc errors in shared/hooks/index.ts). These
  // re-typed locals keep Record<FosterHomeStatus, ...> lookups and the
  // photos map type-safe without resorting to `any`/`@ts-ignore`.
  const status: FosterHomeStatus = mine.status;
  const photos: FosterHomePhoto[] = mine.photos ?? [];
  const isSuspended = status === 'suspended';
  const photoCount = photos.length;
  const canAddPhoto = photoCount < MAX_PHOTOS;

  const toggleAnimalType = (kind: AnimalKind) => {
    if (isSuspended) return;
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

  const handleSave = () => {
    // Defense in depth: a suspended home cannot be edited. The backend still
    // returns 409 foster_home_suspended if this is bypassed — handled below
    // via getErrorMessage, not just the disabled UI.
    if (isSuspended) return;
    if (!validate()) return;

    const payload: UpdateMyFosterHomeRequest = {
      city: city.trim(),
      housing_type: housingType,
      animal_types: animalTypes,
      capacity: Number(capacity),
      description: description.trim(),
      whatsapp_phone: whatsappPhone.trim(),
    };

    updateFosterHome.mutate(payload, {
      onSuccess: () => {
        Alert.alert(i18next.t('common:confirm'), i18next.t('fosterHomes:mine.saved'));
      },
      onError: (err: unknown) => {
        Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
      },
    });
  };

  const pickAndUploadPhoto = async () => {
    if (!canAddPhoto || uploadPhoto.isPending) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    setPhotoError(null);
    try {
      await uploadPhoto.mutateAsync(buildRNFile(result.assets[0].uri));
    } catch (err) {
      // Covers too_many_photos (422) in case of a race with another add.
      setPhotoError(getErrorMessage(err, t));
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    setPhotoError(null);
    setDeletingPhotoId(photoId);
    try {
      await deletePhoto.mutateAsync(photoId);
    } catch (err) {
      setPhotoError(getErrorMessage(err, t));
    } finally {
      setDeletingPhotoId(null);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('fosterHomes:mine.title')}</Text>

      {/* Status banner */}
      <View style={[styles.statusCard, { borderColor: STATUS_COLORS[status] }]}>
        <Text style={[styles.statusLabel, { color: STATUS_COLORS[status] }]}>
          {t(`fosterHomes:status.${status}`)}
        </Text>
        <Text style={styles.statusMessage}>{t(STATUS_MESSAGE_KEY[status])}</Text>
        {status === 'rejected' && mine.rejection_reason ? (
          <Text style={styles.statusReason}>
            {t('fosterHomes:mine.rejectionReason')}: {mine.rejection_reason}
          </Text>
        ) : null}
      </View>

      {isSuspended && (
        <View style={styles.suspendedNotice}>
          <Text style={styles.suspendedNoticeText}>{t('fosterHomes:mine.suspendedFrozen')}</Text>
        </View>
      )}

      {/* Edit form */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('fosterHomes:register.city')}</Text>
        <TextInput
          style={[styles.input, isSuspended && styles.inputDisabled]}
          value={city}
          onChangeText={(text) => {
            setCity(text);
            setErrors((prev) => ({ ...prev, city: undefined }));
          }}
          editable={!isSuspended}
          placeholderTextColor={COLORS.placeholder}
          autoCapitalize="words"
        />
        {errors.city && <Text style={styles.error}>{errors.city}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('fosterHomes:register.housingType')}</Text>
        <View style={styles.chipRow}>
          {HOUSING_TYPES.map((ht) => {
            const active = housingType === ht;
            return (
              <TouchableOpacity
                key={ht}
                style={[styles.chipOption, active && styles.chipOptionActive]}
                onPress={() => !isSuspended && setHousingType(ht)}
                disabled={isSuspended}
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
                disabled={isSuspended}
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

      <View style={styles.section}>
        <Text style={styles.label}>{t('fosterHomes:register.capacity')}</Text>
        <TextInput
          style={[styles.input, isSuspended && styles.inputDisabled]}
          value={capacity}
          onChangeText={(text) => {
            setCapacity(text);
            setErrors((prev) => ({ ...prev, capacity: undefined }));
          }}
          editable={!isSuspended}
          keyboardType="number-pad"
        />
        {errors.capacity && <Text style={styles.error}>{errors.capacity}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('fosterHomes:register.description')}</Text>
        <TextInput
          style={[styles.input, styles.textArea, isSuspended && styles.inputDisabled]}
          value={description}
          onChangeText={(text) => {
            setDescription(text);
            setErrors((prev) => ({ ...prev, description: undefined }));
          }}
          editable={!isSuspended}
          multiline
          numberOfLines={4}
        />
        {errors.description && <Text style={styles.error}>{errors.description}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('fosterHomes:register.whatsapp')}</Text>
        <TextInput
          style={[styles.input, isSuspended && styles.inputDisabled]}
          value={whatsappPhone}
          onChangeText={setWhatsappPhone}
          editable={!isSuspended}
          keyboardType="phone-pad"
        />
      </View>

      {!isSuspended && (
        <TouchableOpacity
          style={[styles.primaryButton, updateFosterHome.isPending && styles.disabledButton]}
          onPress={handleSave}
          disabled={updateFosterHome.isPending}
          accessibilityRole="button"
        >
          {updateFosterHome.isPending ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text style={styles.primaryButtonText}>{t('fosterHomes:mine.save')}</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Photos — retention by design: no "delete home" button (§18). */}
      <View style={styles.photosSection}>
        <Text style={styles.sectionTitle}>{t('fosterHomes:detail.photos')}</Text>

        {photoCount > 0 && (
          <View style={styles.photoGrid}>
            {photos.map((photo: FosterHomePhoto) => (
              <View key={photo.id} style={styles.photoThumbWrapper}>
                <Image source={{ uri: photo.url }} style={styles.photoThumb} />
                <TouchableOpacity
                  style={styles.photoDeleteButton}
                  onPress={() => handleDeletePhoto(photo.id)}
                  disabled={deletingPhotoId === photo.id}
                  accessibilityRole="button"
                  accessibilityLabel={t('fosterHomes:mine.deletePhoto')}
                >
                  {deletingPhotoId === photo.id ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Text style={styles.photoDeleteButtonText}>✕</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {photoError && <Text style={styles.error}>{photoError}</Text>}

        <TouchableOpacity
          style={[styles.addPhotoButton, (!canAddPhoto || uploadPhoto.isPending) && styles.disabledButton]}
          onPress={pickAndUploadPhoto}
          disabled={!canAddPhoto || uploadPhoto.isPending}
          accessibilityRole="button"
        >
          {uploadPhoto.isPending ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Text style={styles.addPhotoButtonText}>{t('fosterHomes:mine.addPhoto')}</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.hint}>{t('fosterHomes:mine.photoLimit')}</Text>
      </View>

      <View style={{ height: 40 }} />
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
    padding: SPACING.lg,
  },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginTop: SPACING.md,
    marginBottom: SPACING.lg,
  },
  loadErrorText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.danger,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  retryButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: COLORS.primary, fontSize: FONTS.sizes.sm, fontWeight: '700' },
  statusCard: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  statusLabel: { fontSize: FONTS.sizes.md, fontWeight: '700', marginBottom: SPACING.xs },
  statusMessage: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  statusReason: { fontSize: FONTS.sizes.sm, color: COLORS.danger, marginTop: SPACING.xs },
  suspendedNotice: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  suspendedNoticeText: { fontSize: FONTS.sizes.sm, color: COLORS.danger },
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
  inputDisabled: { opacity: 0.6 },
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
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    marginTop: SPACING.sm,
    ...SHADOWS.sm,
  },
  disabledButton: { opacity: 0.6 },
  primaryButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.md },
  photosSection: { marginTop: SPACING.lg },
  sectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm },
  photoThumbWrapper: { position: 'relative' },
  photoThumb: { width: 88, height: 88, borderRadius: RADIUS.md },
  photoDeleteButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoDeleteButtonText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  addPhotoButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  addPhotoButtonText: { color: COLORS.primary, fontSize: FONTS.sizes.sm, fontWeight: '700' },
  hint: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: SPACING.xs },
});
