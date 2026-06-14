// ============================================================
// SearchPet - Pet Detail Screen
// ============================================================

import {
  View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Dimensions,
  Alert,
  FlatList,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { useState, useRef, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { usePetByID, useReportsByPetID, useMarkPetAsFound, useBlockUser, useSubmitAbuseReport } from '@shared/hooks';
import { buildWhatsAppContactURL } from '@shared/utils/whatsappTemplates';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { useAuthStore } from '../../store';
import { getDateLocale } from '../../i18n/dateLocale';
import { ShareButton } from '../../components/ShareButton';
import { PdfFlyerButton } from '../../components/PdfFlyerButton';
import { TimelineMap } from '../../components/TimelineMap';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

const { width } = Dimensions.get('window');

export default function PetDetailScreen() {
  const { t, i18n } = useTranslation(['pet_detail', 'common', 'pets', 'story', 'map']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: pet, isLoading } = usePetByID(id);
  const { data: reports } = useReportsByPetID(id);
  const markAsFound = useMarkPetAsFound();
  const { user, isAuthenticated } = useAuthStore();

  const blockUser = useBlockUser();
  const submitAbuseReport = useSubmitAbuseReport();

  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 });
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems[0]?.index != null) {
        setActivePhotoIndex(viewableItems[0].index);
      }
    },
    [],
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!pet) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48 }}>🔍</Text>
        <Text style={styles.notFoundText}>{t('pet_detail:notFound')}</Text>
      </View>
    );
  }

  const petPhotos = pet.photos ?? [];
  const latestReport = reports?.[0];
  const isOwner = isAuthenticated && user?.id === pet.owner_id;
  // canManage: owner (owned pets) or reporter (stray pets, no owner) may manage.
  const canManage = isAuthenticated && (user?.id === pet.owner_id || user?.id === pet.reporter_id);

  const handleBlock = (ownerUserId: string) => {
    blockUser.mutate(
      { userId: ownerUserId },
      {
        onSuccess: () => {
          Alert.alert(i18next.t('pet_detail:blockedSuccess'), i18next.t('pet_detail:blockedText'));
        },
        onError: (err: unknown) => {
          Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
        },
      },
    );
  };

  const handleReport = (ownerUserId: string, petId: string) => {
    const reasons: Array<{ label: string; value: string }> = [
      { label: i18next.t('pet_detail:spam'), value: 'spam' },
      { label: i18next.t('pet_detail:fake'), value: 'fake' },
      { label: i18next.t('pet_detail:abuse'), value: 'abuse' },
      { label: i18next.t('pet_detail:inappropriate'), value: 'inappropriate' },
      { label: i18next.t('pet_detail:other'), value: 'other' },
    ];
    Alert.alert(
      i18next.t('pet_detail:reportReason'),
      '',
      [
        ...reasons.map((r) => ({
          text: r.label,
          onPress: () => {
            submitAbuseReport.mutate(
              { target_user_id: ownerUserId, reason: r.value as 'spam' | 'fake' | 'abuse' | 'inappropriate' | 'other' },
              {
                onSuccess: () => Alert.alert(i18next.t('pet_detail:reportSuccess'), ''),
                onError: (err: unknown) => Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t)),
              },
            );
          },
        })),
        { text: i18next.t('common:cancel'), style: 'cancel' },
      ],
    );
  };

  const showKebabSheet = (ownerUserId: string, petId: string) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [i18next.t('common:cancel'), i18next.t('pet_detail:blockUser'), i18next.t('pet_detail:reportAbuse')],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 1,
        },
        (idx) => {
          if (idx === 1) handleBlock(ownerUserId);
          if (idx === 2) handleReport(ownerUserId, petId);
        },
      );
    } else {
      Alert.alert(i18next.t('pet_detail:moreOptions'), '', [
        { text: i18next.t('common:cancel'), style: 'cancel' },
        { text: i18next.t('pet_detail:blockUser'), style: 'destructive', onPress: () => handleBlock(ownerUserId) },
        { text: i18next.t('pet_detail:reportAbuse'), onPress: () => handleReport(ownerUserId, petId) },
      ]);
    }
  };

  const contactOwner = () => {
    if (pet.owner?.phone) {
      // Usamos la utilidad compartida para construir la URL de WhatsApp
      const url = buildWhatsAppContactURL(pet.owner.phone, pet);
      Linking.openURL(url);
    } else {
      router.push(`/chat/${pet.owner_id}?userName=${encodeURIComponent(pet.owner?.name ?? '')}` as `/${string}`);
    }
  };

  const handleMarkAsFound = () => {
    Alert.alert(
      i18next.t('pet_detail:markAsFound'),
      i18next.t('pet_detail:foundConfirm', { name: pet.name }),
      [
        { text: i18next.t('common:cancel'), style: 'cancel' },
        {
          text: i18next.t('common:confirm'),
          style: 'default',
          onPress: () =>
            markAsFound.mutate(pet.id, {
              onSuccess: () => {
                Alert.alert(
                  i18next.t('pet_detail:foundSuccess', { name: pet.name }),
                  '',
                  [
                    {
                      text: i18next.t('story:create'),
                      onPress: () => router.push(`/story/create?petId=${pet.id}`),
                    },
                    { text: i18next.t('common:cancel'), style: 'cancel' },
                  ],
                );
              },
            }),
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Carrusel de fotos */}
      <View style={styles.carouselContainer}>
        {petPhotos.length > 0 ? (
          <FlatList
            data={petPhotos}
            keyExtractor={(item) => item.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig.current}
            renderItem={({ item }) => (
              <Image source={{ uri: item.url }} style={styles.carouselImage} />
            )}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={{ fontSize: 60 }}>🐾</Text>
          </View>
        )}
        {/* Banner de encontrada */}
        {pet.status === 'found' && (
          <View style={styles.foundBanner}>
            <Text style={styles.foundBannerText}>{t('map:found')}</Text>
          </View>
        )}
        {/* Dots indicator */}
        {petPhotos.length > 1 && (
          <View style={styles.dotsRow}>
            {petPhotos.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === activePhotoIndex && styles.activeDot]}
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.content}>
        {/* Nombre y status */}
        <View style={styles.headerRow}>
          <Text style={styles.petName}>{pet.name}</Text>
          <View style={[
            styles.statusBadge,
            {
              backgroundColor:
                pet.status === 'found'      ? COLORS.found :
                pet.status === 'archived'   ? COLORS.textMuted :
                pet.status === 'registered' ? COLORS.textSecondary :
                pet.status === 'stray'      ? COLORS.warning :
                COLORS.lost,
            },
          ]}>
            <Text style={styles.statusText}>
              {t(`pets:status.${pet.status}`).toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Detalles */}
        <View style={styles.detailsCard}>
          {pet.type && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('pet_detail:type')}</Text>
              <Text style={styles.detailValue}>{pet.type}</Text>
            </View>
          )}
          {pet.breed && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('pet_detail:breed')}</Text>
              <Text style={styles.detailValue}>{pet.breed}</Text>
            </View>
          )}
          {pet.color && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('pet_detail:color')}</Text>
              <Text style={styles.detailValue}>{pet.color}</Text>
            </View>
          )}
          {latestReport?.location_description && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('pet_detail:lastLocation')}</Text>
              <Text style={styles.detailValue}>{latestReport.location_description}</Text>
            </View>
          )}
        </View>

        {/* Descripción */}
        {pet.description && (
          <View style={styles.descriptionCard}>
            <Text style={styles.sectionTitle}>{t('pet_detail:description')}</Text>
            <Text style={styles.descriptionText}>{pet.description}</Text>
          </View>
        )}

        {/* Botón Marcar como encontrada — owner cuando está lost, reporter cuando es stray */}
        {canManage && (pet.status === 'lost' || pet.status === 'stray') && (
          <TouchableOpacity
            style={[styles.markFoundButton, markAsFound.isPending && styles.disabledButton]}
            onPress={handleMarkAsFound}
            disabled={markAsFound.isPending}
            activeOpacity={0.8}
          >
            {markAsFound.isPending ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text style={styles.markFoundButtonText}>✅ {t('pet_detail:markAsFound')}</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Botón Contar historia — solo para el dueño cuando ya fue encontrada */}
        {isOwner && pet.status === 'found' && (
          <TouchableOpacity
            style={styles.storyButton}
            onPress={() => router.push(`/story/create?petId=${pet.id}`)}
            activeOpacity={0.8}
          >
            <Text style={styles.storyButtonText}>🎉 {t('story:create')}</Text>
          </TouchableOpacity>
        )}

        {/* Dueño */}
        {pet.owner && (
          <View style={styles.ownerCard}>
            <Text style={styles.sectionTitle}>{t('pet_detail:ownerContact')}</Text>
            <View style={styles.ownerInfo}>
              <View style={styles.ownerAvatar}>
                <Text style={{ fontSize: 24 }}>👤</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ownerName}>{pet.owner.name}</Text>
                {pet.owner.is_verified && (
                  <Text style={styles.verifiedText}>{t('pet_detail:verified')}</Text>
                )}
              </View>
              {!isOwner && (
                <TouchableOpacity
                  onPress={() => showKebabSheet(pet.owner_id, pet.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.kebabIcon}>⋮</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={styles.contactButton} onPress={contactOwner}>
              <Text style={styles.contactButtonText}>{t('pet_detail:contact')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Compartir */}
        <ShareButton
          petId={pet.id}
          petName={pet.name}
          petType={pet.type}
          status={pet.status === 'found' ? 'found' : 'lost'}
          pet={pet}
        />

        {/* Volante PDF */}
        <PdfFlyerButton pet={pet} reports={reports} />

        {/* Mapa de avistamientos */}
        <TimelineMap reports={reports ?? []} />

        {/* Timeline de reportes */}
        {reports && reports.length > 0 && (
          <View style={styles.timelineCard}>
            <Text style={styles.sectionTitle}>
              {t('pet_detail:timeline', { count: reports.length })}
            </Text>
            {reports.map((report, index) => {
              // Fecha efectiva: occurred_at si existe, sino created_at
              const dateStr = report.occurred_at ?? report.created_at;
              const displayDate = new Date(dateStr).toLocaleDateString(getDateLocale(i18n.language), {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <View key={report.id} style={styles.timelineItem}>
                  <View style={[
                    styles.timelineDot,
                    { backgroundColor: report.status === 'found' ? COLORS.found : report.status === 'sighting' ? COLORS.sighting : COLORS.lost },
                  ]} />
                  {index < reports.length - 1 && <View style={styles.timelineLine} />}
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineStatus}>
                      {report.status === 'lost' ? t('pets:status.lost') : report.status === 'found' ? t('pets:status.found') : t('map:legendSighting')}
                    </Text>
                    {report.is_verified && (
                      <Text style={styles.verifiedBadge}>✓ {t('pet_detail:verified')}</Text>
                    )}
                    {report.location_description && (
                      <Text style={styles.timelineLocation}>
                        📍 {report.location_description}
                      </Text>
                    )}
                    <Text style={styles.timelineDate}>
                      {displayDate}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={{ height: 80 }} />
      </View>
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
  notFoundText: {
    fontSize: FONTS.sizes.lg,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  carouselContainer: { width, height: 300, position: 'relative' },
  carouselImage: { width, height: 300, resizeMode: 'cover' },
  dotsRow: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  activeDot: {
    backgroundColor: '#ffffff',
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  foundBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(34, 197, 94, 0.9)',
    paddingVertical: 8,
    alignItems: 'center',
  },
  foundBannerText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: FONTS.sizes.sm,
    letterSpacing: 1,
  },
  content: { padding: SPACING.lg },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  petName: { fontSize: FONTS.sizes.xxl, fontWeight: '700', color: COLORS.textPrimary, flex: 1 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.sm },
  statusText: { color: COLORS.white, fontSize: 12, fontWeight: '800' },
  detailsCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailLabel: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, fontWeight: '500' },
  detailValue: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, fontWeight: '600' },
  descriptionCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  descriptionText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, lineHeight: 22 },
  markFoundButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  disabledButton: {
    opacity: 0.6,
  },
  markFoundButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  storyButton: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  storyButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  ownerCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  ownerInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  ownerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  ownerName: { fontSize: FONTS.sizes.md, fontWeight: '600', color: COLORS.textPrimary },
  verifiedText: { fontSize: FONTS.sizes.xs, color: COLORS.success, fontWeight: '600', marginTop: 2 },
  contactButton: {
    backgroundColor: COLORS.whatsapp,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  contactButtonText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },
  kebabIcon: { fontSize: 22, color: COLORS.textSecondary, paddingHorizontal: 4 },
  timelineCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  timelineItem: { flexDirection: 'row', marginBottom: SPACING.md, position: 'relative' },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginRight: SPACING.md, marginTop: 4 },
  timelineLine: {
    position: 'absolute',
    left: 5,
    top: 16,
    bottom: -SPACING.md,
    width: 2,
    backgroundColor: COLORS.border,
  },
  timelineContent: { flex: 1 },
  timelineStatus: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textPrimary },
  verifiedBadge: { fontSize: 11, color: '#16a34a', fontWeight: '700', marginTop: 2 },
  timelineLocation: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  timelineDate: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: 2 },
});
