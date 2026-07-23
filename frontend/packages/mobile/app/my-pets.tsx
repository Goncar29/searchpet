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
import { PawPlaceholder } from '../components/PawPlaceholder';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useMyPets, useReportedPets, useDeletePet, useUploadPhotoNative, useCreateReport, useMarkPetAsFound, useUpdatePet } from '../../shared/hooks';
import { getErrorMessage } from '../../shared/utils/apiErrors';
import { useLocationStore } from '../store';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS, PET_TYPES } from '../constants';
import type { Pet } from '../../shared/types';

export default function MyPetsScreen() {
  const { t } = useTranslation(['my_pets', 'common', 'adoption']);
  const router = useRouter();
  const [tab, setTab] = useState<'owned' | 'reported' | 'adoption'>('owned');
  const owned = useMyPets();
  const reported = useReportedPets();
  const activeQuery = tab === 'reported' ? reported : owned;
  const { isLoading, refetch, isRefetching } = activeQuery;

  // Adoption listings are owned pets too, but they get their own tab so they
  // don't clutter "Mis mascotas" (which is for the owner's regular pets) —
  // mirrors web's MyPetsPage split.
  const ownedNonAdoption = (owned.data ?? []).filter(
    (p: Pet) => p.status !== 'adoption' && p.status !== 'adopted'
  );
  const adoptionPets = (owned.data ?? []).filter(
    (p: Pet) => p.status === 'adoption' || p.status === 'adopted'
  );
  const pets = tab === 'owned' ? ownedNonAdoption : tab === 'reported' ? reported.data : adoptionPets;

  const deletePet = useDeletePet();
  const uploadPhoto = useUploadPhotoNative();
  const createReport = useCreateReport();
  const markAsFound = useMarkPetAsFound();
  const updatePet = useUpdatePet();
  const { latitude, longitude } = useLocationStore();

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'registered': return t('pets:status.registered');
      case 'lost':       return t('pets:status.lost');
      case 'stray':      return t('pets:status.stray');
      case 'found':      return t('pets:status.found');
      case 'archived':   return t('pets:status.archived');
      case 'adoption':   return t('pets:status.adoption');
      case 'adopted':    return t('pets:status.adopted');
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'registered': return COLORS.textSecondary;
      case 'lost':       return COLORS.lost;
      case 'stray':      return COLORS.warning;
      case 'found':      return COLORS.success;
      case 'archived':   return COLORS.textMuted;
      case 'adoption':   return COLORS.primary;
      case 'adopted':    return COLORS.success;
      default: return COLORS.textSecondary;
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
    } catch (err) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
    }
  };

  const handleReport = (pet: Pet) => {
    Alert.alert(
      i18next.t('my_pets:reportTitle', { name: pet.name }),
      i18next.t('my_pets:reportQuestion'),
      [
        { text: i18next.t('common:cancel'), style: 'cancel' },
        {
          text: i18next.t('my_pets:reportLostOption'),
          onPress: () => submitReport(pet.id, 'lost'),
        },
        {
          text: i18next.t('my_pets:reportFoundOption'),
          onPress: () => submitReport(pet.id, 'found'),
        },
        {
          text: i18next.t('my_pets:reportSightingOption'),
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
      Alert.alert(i18next.t('my_pets:reportCreated'), i18next.t('my_pets:reportCreatedText'));
    } catch (err) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
    }
  };

  const handleMarkAsFound = (pet: Pet) => {
    Alert.alert(
      i18next.t('my_pets:markFoundTitle'),
      i18next.t('my_pets:markFoundConfirm', { name: pet.name }),
      [
        { text: i18next.t('common:cancel'), style: 'cancel' },
        {
          text: i18next.t('common:confirm'),
          onPress: async () => {
            try {
              await markAsFound.mutateAsync(pet.id);
            } catch (err: unknown) {
              Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
            }
          },
        },
      ]
    );
  };

  const handleMarkAdopted = (pet: Pet) => {
    Alert.alert(
      i18next.t('adoption:profile.markAdopted'),
      i18next.t('adoption:profile.markAdoptedConfirm'),
      [
        { text: i18next.t('common:cancel'), style: 'cancel' },
        {
          text: i18next.t('common:confirm'),
          onPress: async () => {
            try {
              await updatePet.mutateAsync({ id: pet.id, data: { status: 'adopted' } });
            } catch (err: unknown) {
              Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
            }
          },
        },
      ]
    );
  };

  const handleDelete = (pet: Pet) => {
    Alert.alert(
      i18next.t('my_pets:deleteTitle'),
      i18next.t('my_pets:deleteConfirmText', { name: pet.name }),
      [
        { text: i18next.t('common:cancel'), style: 'cancel' },
        {
          text: i18next.t('common:delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePet.mutateAsync(pet.id);
            } catch (err: unknown) {
              Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
            }
          },
        },
      ]
    );
  };

  const renderTab = (key: 'owned' | 'reported' | 'adoption', label: string) => (
    <TouchableOpacity
      onPress={() => setTab(key)}
      style={[styles.tab, tab === key && styles.tabActive]}
      activeOpacity={0.7}
      accessibilityRole="tab"
      accessibilityState={{ selected: tab === key }}
    >
      <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {renderTab('owned', t('pets:reports.tabOwned'))}
        {renderTab('reported', t('pets:reports.tabReported'))}
        {renderTab('adoption', t('adoption:profile.tab'))}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t('my_pets:loadingPets')}</Text>
        </View>
      ) : (
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
                    <Text style={styles.photoAddText}>{t('my_pets:addPhoto')}</Text>
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
                    {t('my_pets:colorLabel', { color: item.color })}
                  </Text>
                )}

                <Text style={styles.petDetail}>
                  📷 {t('my_pets:photoCount', { current: item.photos?.length ?? 0 })}
                </Text>
              </View>

              {/* Acciones */}
              <View style={styles.actions}>
                {item.status !== 'adoption' && item.status !== 'adopted' && (
                  <TouchableOpacity
                    style={styles.reportButton}
                    onPress={() => handleReport(item)}
                  >
                    <Text style={styles.reportButtonText}>{t('my_pets:reportButton')}</Text>
                  </TouchableOpacity>
                )}
                {(item.status === 'lost' || item.status === 'stray') && (
                  <TouchableOpacity
                    style={styles.foundButton}
                    onPress={() => handleMarkAsFound(item)}
                  >
                    <Text style={styles.foundButtonText}>{t('my_pets:foundButton')}</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'adoption' && (
                  <TouchableOpacity
                    style={styles.foundButton}
                    onPress={() => handleMarkAdopted(item)}
                  >
                    <Text style={styles.foundButtonText}>{t('adoption:profile.markAdopted')}</Text>
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
          tab === 'reported' ? (
            <View style={styles.empty}>
              <View style={{ marginBottom: 12 }}><PawPlaceholder size={56} /></View>
              <Text style={styles.emptyText}>{t('pets:reports.empty')}</Text>
            </View>
          ) : tab === 'adoption' ? (
            <View style={styles.empty}>
              <View style={{ marginBottom: 12 }}><PawPlaceholder size={56} /></View>
              <Text style={styles.emptyText}>{t('adoption:profile.empty')}</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <View style={{ marginBottom: 12 }}><PawPlaceholder size={56} /></View>
              <Text style={styles.emptyTitle}>{t('my_pets:emptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('my_pets:emptyText')}</Text>
              <TouchableOpacity
                style={styles.createButton}
                onPress={() => router.push('/pets/register')}
              >
                <Text style={styles.createButtonText}>{t('my_pets:registerPet')}</Text>
              </TouchableOpacity>
            </View>
          )
        }
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.background,
  },
  tab: {
    flex: 1,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: COLORS.primary,
  },
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
