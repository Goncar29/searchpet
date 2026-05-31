// ============================================================
// SearchPet - Mis Mascotas Screen
// ============================================================

import {
  View,
  Text,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useMyPets, useDeletePet, useUploadPhotoNative, useCreateReport, useMarkPetAsFound } from '../../shared/hooks';
import { useLocationStore } from '../store';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS, PET_TYPES } from '../constants';
import type { Pet } from '../../shared/types';

export default function MyPetsScreen() {
  const router = useRouter();
  const { data: pets, isLoading, refetch, isRefetching } = useMyPets();
  const deletePet = useDeletePet();
  const uploadPhoto = useUploadPhotoNative();
  const createReport = useCreateReport();
  const markAsFound = useMarkPetAsFound();
  const { latitude, longitude } = useLocationStore();

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'Activa';
      case 'found': return 'Encontrada';
      case 'archived': return 'Archivada';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return COLORS.primary;
      case 'found': return COLORS.success;
      case 'archived': return COLORS.textMuted;
      default: return COLORS.primary;
    }
  };

  const getPetIcon = (type: string) => {
    return PET_TYPES.find(t => t.value === type)?.icon || '🐾';
  };

  const handleAddPhoto = async (pet: Pet) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    try {
      await uploadPhoto.mutateAsync({ petId: pet.id, uri: result.assets[0].uri });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'No se pudo subir la foto');
    }
  };

  const handleReport = (pet: Pet) => {
    Alert.alert(
      `Reportar a ${pet.name}`,
      '¿Qué querés reportar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: '🔴 Perdida',
          onPress: () => submitReport(pet.id, 'lost'),
        },
        {
          text: '🟢 Encontrada',
          onPress: () => submitReport(pet.id, 'found'),
        },
        {
          text: '🟡 Avistamiento',
          onPress: () => submitReport(pet.id, 'sighting'),
        },
      ]
    );
  };

  const submitReport = async (petId: string, status: 'lost' | 'found' | 'sighting') => {
    let lat = latitude || -34.9011;
    let lng = longitude || -56.1645;

    try {
      const loc = await Location.getCurrentPositionAsync({});
      lat = loc.coords.latitude;
      lng = loc.coords.longitude;
    } catch {}

    try {
      await createReport.mutateAsync({ pet_id: petId, status, latitude: lat, longitude: lng });
      Alert.alert('Reporte creado', 'El reporte fue publicado y aparecerá en el mapa y el feed.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'No se pudo crear el reporte');
    }
  };

  const handleMarkAsFound = (pet: Pet) => {
    Alert.alert(
      '¿Mascota encontrada?',
      `¿Confirmás que ${pet.name} fue encontrada? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            try {
              await markAsFound.mutateAsync(pet.id);
            } catch {
              Alert.alert('Error', 'No se pudo actualizar el estado. Intentá de nuevo.');
            }
          },
        },
      ]
    );
  };

  const handleDelete = (pet: Pet) => {
    Alert.alert(
      'Eliminar mascota',
      `¿Estás seguro que querés eliminar a ${pet.name}? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePet.mutateAsync(pet.id);
            } catch {
              Alert.alert('Error', 'No se pudo eliminar la mascota. Intentá de nuevo.');
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Cargando tus mascotas...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={pets}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const primaryPhoto = item.photos?.find(p => p.is_primary) || item.photos?.[0];
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/pet/${item.id}`)}
              activeOpacity={0.7}
            >
              {/* Foto */}
              <TouchableOpacity
                style={styles.photoContainer}
                onPress={() => !primaryPhoto && handleAddPhoto(item)}
                activeOpacity={primaryPhoto ? 1 : 0.7}
              >
                {uploadPhoto.isPending && uploadPhoto.variables?.petId === item.id ? (
                  <View style={styles.photoPlaceholder}>
                    <ActivityIndicator color={COLORS.primary} />
                  </View>
                ) : primaryPhoto ? (
                  <Image source={{ uri: primaryPhoto.url }} style={styles.photo} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Text style={styles.photoIcon}>{getPetIcon(item.type)}</Text>
                    <Text style={styles.photoAddText}>+ Foto</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Info */}
              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text style={styles.petName} numberOfLines={1}>{item.name}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                    <Text style={styles.statusText}>{getStatusLabel(item.status)}</Text>
                  </View>
                </View>

                <Text style={styles.petType}>
                  {getPetIcon(item.type)} {item.type}
                  {item.breed ? ` · ${item.breed}` : ''}
                </Text>

                {item.color && (
                  <Text style={styles.petDetail} numberOfLines={1}>
                    Color: {item.color}
                  </Text>
                )}
              </View>

              {/* Acciones */}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.reportButton}
                  onPress={() => handleReport(item)}
                >
                  <Text style={styles.reportButtonText}>Reportar</Text>
                </TouchableOpacity>
                {item.status === 'active' && (
                  <TouchableOpacity
                    style={styles.foundButton}
                    onPress={() => handleMarkAsFound(item)}
                  >
                    <Text style={styles.foundButtonText}>Encontrada</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDelete(item)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.deleteIcon}>🗑️</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={COLORS.primary}
          />
        }
        contentContainerStyle={pets?.length === 0 ? styles.emptyContainer : styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🐾</Text>
            <Text style={styles.emptyTitle}>No tenés mascotas registradas</Text>
            <Text style={styles.emptyText}>
              Registrá a tu mascota para publicar reportes y que la comunidad te ayude a encontrarla.
            </Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => router.push('/(tabs)/post')}
            >
              <Text style={styles.createButtonText}>Registrar mascota</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
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
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
  list: {
    padding: SPACING.lg,
    paddingBottom: 100,
  },
  emptyContainer: {
    flex: 1,
    padding: SPACING.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    ...SHADOWS.md,
  },
  photoContainer: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    marginRight: SPACING.md,
  },
  photo: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoIcon: { fontSize: 28 },
  photoAddText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  info: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  petName: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    flex: 1,
    marginRight: SPACING.sm,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  statusText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  petType: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: 2,
    textTransform: 'capitalize',
  },
  petDetail: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
  },
  actions: {
    alignItems: 'center',
    gap: SPACING.xs,
  },
  reportButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  reportButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  foundButton: {
    backgroundColor: COLORS.success,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  foundButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  deleteButton: {
    padding: SPACING.xs,
  },
  deleteIcon: { fontSize: 18 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
  },
  emptyIcon: { fontSize: 64, marginBottom: SPACING.md },
  emptyTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.lg,
    lineHeight: 22,
  },
  createButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
  },
  createButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
});
