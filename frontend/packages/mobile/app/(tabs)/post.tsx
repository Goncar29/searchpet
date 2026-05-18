// ============================================================
// SearchPet - Post Screen (Publicar mascota perdida)
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
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCreatePet, useCreateReport, useUploadPhotoNative } from '../../../shared/hooks';
import { useAuthStore, useLocationStore } from '../../store';
import { COLORS, SPACING, FONTS, RADIUS, PET_TYPES } from '../../constants';
import type { PetType } from '../../../shared/types';

export default function PostScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { latitude, longitude } = useLocationStore();
  const createPet = useCreatePet();
  const createReport = useCreateReport();
  const uploadPhoto = useUploadPhotoNative();

  const [name, setName] = useState('');
  const [type, setType] = useState<PetType>('perro');
  const [breed, setBreed] = useState('');
  const [color, setColor] = useState('');
  const [description, setDescription] = useState('');
  const [locationDesc, setLocationDesc] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isAuthenticated) {
    return (
      <View style={styles.authRequired}>
        <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>🔒</Text>
        <Text style={styles.authTitle}>Inicia sesión</Text>
        <Text style={styles.authText}>
          Necesitas una cuenta para publicar mascotas perdidas
        </Text>
        <TouchableOpacity
          style={styles.authButton}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.authButtonText}>Iniciar Sesión</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/register')}>
          <Text style={styles.registerLink}>¿No tienes cuenta? Regístrate</Text>
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
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tu cámara');
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
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre de la mascota es requerido');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Crear la mascota
      const pet = await createPet.mutateAsync({
        name: name.trim(),
        type,
        breed: breed.trim(),
        color: color.trim(),
        description: description.trim(),
      });

      // 2. Crear el reporte de ubicación
      let reportLat = latitude || -34.9011;
      let reportLng = longitude || -56.1645;

      try {
        const loc = await Location.getCurrentPositionAsync({});
        reportLat = loc.coords.latitude;
        reportLng = loc.coords.longitude;
      } catch {}

      await createReport.mutateAsync({
        pet_id: pet.id,
        status: 'lost',
        latitude: reportLat,
        longitude: reportLng,
        location_description: locationDesc.trim(),
      });

      // 3. Subir fotos (no bloquea si falla — la mascota ya fue creada)
      for (const uri of photos) {
        try {
          await uploadPhoto.mutateAsync({ petId: pet.id, uri });
        } catch {
          // La mascota ya existe — no hacemos rollback, seguimos
        }
      }

      Alert.alert(
        'Publicado',
        `${name} ha sido publicado como perdido. Esperamos encontrarlo pronto.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );

      // Reset form
      setName('');
      setBreed('');
      setColor('');
      setDescription('');
      setLocationDesc('');
      setPhotos([]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudo publicar');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>Publicar mascota perdida</Text>

        {/* Fotos */}
        <Text style={styles.label}>Fotos</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
          {photos.map((uri, i) => (
            <TouchableOpacity key={i} onPress={() => removePhoto(i)}>
              <Image source={{ uri }} style={styles.photoThumb} />
              <View style={styles.photoRemove}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]}
            onPress={pickImage}
            disabled={atLimit}
          >
            <Text style={{ fontSize: 28, color: COLORS.textMuted }}>+</Text>
            <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Galería</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]}
            onPress={takePhoto}
            disabled={atLimit}
          >
            <Text style={{ fontSize: 28, color: COLORS.textMuted }}>📷</Text>
            <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Cámara</Text>
          </TouchableOpacity>
        </ScrollView>
        {atLimit && (
          <Text style={styles.photoLimitText}>Máximo 3 fotos</Text>
        )}

        {/* Nombre */}
        <Text style={styles.label}>Nombre *</Text>
        <TextInput
          style={styles.input}
          placeholder="Nombre de la mascota"
          placeholderTextColor={COLORS.placeholder}
          value={name}
          onChangeText={setName}
        />

        {/* Tipo */}
        <Text style={styles.label}>Tipo *</Text>
        <View style={styles.typeRow}>
          {PET_TYPES.map((pt) => (
            <TouchableOpacity
              key={pt.value}
              style={[
                styles.typeButton,
                type === pt.value && styles.typeButtonActive,
              ]}
              onPress={() => setType(pt.value as PetType)}
            >
              <Text style={{ fontSize: 20 }}>{pt.icon}</Text>
              <Text
                style={[
                  styles.typeLabel,
                  type === pt.value && styles.typeLabelActive,
                ]}
              >
                {pt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Raza */}
        <Text style={styles.label}>Raza</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: Labrador, Siamés..."
          placeholderTextColor={COLORS.placeholder}
          value={breed}
          onChangeText={setBreed}
        />

        {/* Color */}
        <Text style={styles.label}>Color</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: Dorado, Negro con blanco..."
          placeholderTextColor={COLORS.placeholder}
          value={color}
          onChangeText={setColor}
        />

        {/* Descripción */}
        <Text style={styles.label}>Descripción</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Describe a tu mascota: tamaño, señas particulares..."
          placeholderTextColor={COLORS.placeholder}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Última ubicación */}
        <Text style={styles.label}>Última ubicación conocida</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: Parque Rodó, esquina 21 de Septiembre..."
          placeholderTextColor={COLORS.placeholder}
          value={locationDesc}
          onChangeText={setLocationDesc}
        />

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitButton, isSubmitting && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.submitText}>Publicar mascota</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg },
  sectionTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    marginTop: SPACING.md,
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
  },
  textArea: {
    minHeight: 100,
    paddingTop: 14,
  },
  photoRow: {
    flexDirection: 'row',
    marginVertical: SPACING.sm,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: RADIUS.md,
    marginRight: SPACING.sm,
  },
  photoRemove: {
    position: 'absolute',
    top: -4,
    right: 4,
    backgroundColor: COLORS.danger,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhoto: {
    width: 80,
    height: 80,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  addPhotoDisabled: {
    opacity: 0.4,
  },
  photoLimitText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  typeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  typeButton: {
    flex: 1,
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
  },
  typeButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#FFF0E8',
  },
  typeLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 4,
    fontWeight: '500',
  },
  typeLabelActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
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
