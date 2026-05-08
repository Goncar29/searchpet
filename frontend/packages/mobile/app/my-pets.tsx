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
import { useMyPets, useDeletePet } from '../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS, PET_TYPES } from '../constants';
import type { Pet } from '../../shared/types';

export default function MyPetsScreen() {
  const router = useRouter();
  const { data: pets, isLoading, refetch, isRefetching } = useMyPets();
  const deletePet = useDeletePet();

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
              <View style={styles.photoContainer}>
                {primaryPhoto ? (
                  <Image source={{ uri: primaryPhoto.url }} style={styles.photo} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Text style={styles.photoIcon}>{getPetIcon(item.type)}</Text>
                  </View>
                )}
              </View>

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
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDelete(item)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.deleteIcon}>🗑️</Text>
              </TouchableOpacity>
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
  photoIcon: { fontSize: 32 },
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
  deleteButton: {
    padding: SPACING.sm,
    marginLeft: SPACING.sm,
  },
  deleteIcon: { fontSize: 20 },
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
