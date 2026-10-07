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
import { formatPetAge } from '@shared/utils/petAge';
import { formatLastSeen } from '@shared/utils/lastSeen';
import i18next from 'i18next';
import { usePetByID, useReportsByPetID, useMarkPetAsFound, useBlockUser, useSubmitAbuseReport } from '@shared/hooks';
import { buildWhatsAppContactURL } from '@shared/utils/whatsappTemplates';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { useAuthStore } from '../../store';
import { getDateLocale } from '../../i18n/dateLocale';
import { ShareButton } from '../../components/ShareButton';
import { PawPlaceholder } from '../../components/PawPlaceholder';
import { PdfFlyerButton } from '../../components/PdfFlyerButton';
import { TimelineMap } from '../../components/TimelineMap';
import { AdoptionPetBody } from '../../components/AdoptionPetBody';
import { HelperPickerModal } from '../../components/HelperPickerModal';
import { LIGHT_COLORS, SPACING, FONTS, RADIUS, SHADOWS, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';
import { ListState } from '../../components/list/ListState';
import type { Report } from '../../../shared/types';
import { IMAGE_BOXES } from '../../constants/imageSizes';
import { Icon } from '../../components/Icon';
import { IconLabel } from '../../components/IconLabel';

const { width } = Dimensions.get('window');

export default function PetDetailScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation(['pet_detail', 'common', 'pets', 'story', 'map', 'adoption']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: pet, isLoading } = usePetByID(id);
  const reportsQuery = useReportsByPetID(id);
  // Sigue disponible sin garantías para el volante PDF, que ya sabía tratar el
  // `undefined`. El mapa y el timeline pasan por `ListState`.
  const reports = reportsQuery.data;
  const markAsFound = useMarkPetAsFound();
  const { user, isAuthenticated } = useAuthStore();

  const blockUser = useBlockUser();
  const submitAbuseReport = useSubmitAbuseReport();

  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  // Marking found asks who helped first: a native Alert cannot host the list.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [foundError, setFoundError] = useState<string | null>(null);
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 });
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      if (viewableItems[0]?.index != null) {
        setActivePhotoIndex(viewableItems[0].index);
      }
    },
    [],
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!pet) {
    return (
      <View style={styles.center}>
        <Icon name="search" size={48} color={colors.textMuted} />
        <Text style={styles.notFoundText}>{t('pet_detail:notFound')}</Text>
      </View>
    );
  }

  const petPhotos = pet.photos ?? [];
  // La misma funcion que usan PetDetailPage y SharedPetPage en web: la regla del
  // "aprox." es un invariante, no presentacion, asi que vive en shared/ y no se
  // duplica por plataforma.
  const edadTexto = formatPetAge(t, pet.birth_date, pet.birth_date_precision);

  // null cuando el backend no manda el campo — o sea cuando la pregunta no
  // aplica a ese estado. Nunca dice "vencido": eso es jerga nuestra y sugeriría
  // que el animal ya no está, que es justo lo que no sabemos.
  //
  // getDateLocale y NO i18n.language crudo: esta pantalla ya formatea sus otras
  // fechas así ('es' -> 'es-UY'), y pasarle el idioma pelado daría un formato
  // distinto al del resto de la misma ficha.
  const vistoPorUltimaVez = formatLastSeen(t, pet.last_seen_at, getDateLocale(i18n.language));
  const latestReport = reports?.[0];
  const isOwner = isAuthenticated && user?.id === pet.owner_id;
  // canManage: owner (owned pets) or reporter (stray pets, no owner) may manage.
  const canManage = isAuthenticated && (user?.id === pet.owner_id || user?.id === pet.reporter_id);
  const isAdoptionListing = pet.status === 'adoption' || pet.status === 'adopted';

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
    const reasons: { label: string; value: string }[] = [
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

  const openFoundPicker = () => {
    setFoundError(null);
    setPickerOpen(true);
  };

  // `helperIds` undefined = there were no candidates (nothing to send); `[]` =
  // the owner said nobody helped. The picker keeps the two apart.
  const confirmFound = (helperIds: string[] | undefined) => {
    markAsFound.mutate(
      { id: pet.id, helperIds },
      {
        onSuccess: () => {
          setPickerOpen(false);
          Alert.alert(
            i18next.t('pet_detail:foundSuccess', { name: pet.name }),
            i18next.t('pets:detail.foundNudgeText'),
            [
              {
                text: i18next.t('story:create'),
                onPress: () => router.push(`/story/create?petId=${pet.id}`),
              },
              { text: i18next.t('common:cancel'), style: 'cancel' },
            ],
          );
        },
        // The modal stays open with the selection, so the owner can fix it.
        onError: (err: unknown) => setFoundError(getErrorMessage(err, (key) => t(key))),
      },
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
              <Image source={{ uri: cloudinaryThumb(item.url, ...IMAGE_BOXES.carouselTall) }} style={styles.carouselImage} />
            )}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <PawPlaceholder size={72} />
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
          {/* A badge fill behind white text: the gray stays the light one in both
              themes, since white text vanishes on the dark textSecondary. */}
          <View style={[
            styles.statusBadge,
            {
              backgroundColor:
                pet.status === 'found'      ? colors.found :
                pet.status === 'adopted'    ? colors.adopted :
                pet.status === 'adoption'   ? colors.adoption :
                pet.status === 'archived'   ? colors.textMuted :
                pet.status === 'registered' ? LIGHT_COLORS.textSecondary :
                pet.status === 'stray'      ? colors.warning :
                colors.lost,
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
              {/* Traducido, no crudo: sin esto dice "perro" en minuscula aunque
                  la app este en ingles. Mismo defecto que tenia la landing. */}
              <Text style={styles.detailValue}>{t(`pets:types.${pet.type}`)}</Text>
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
          {/* 'unknown' se OMITE: una fila que dice "No se" no ayuda a reconocer
              a la mascota. Misma decision que en web. */}
          {pet.gender && pet.gender !== 'unknown' && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('pet_detail:gender')}</Text>
              <Text style={styles.detailValue}>{t(`pets:genders.${pet.gender}`)}</Text>
            </View>
          )}
          {/* La edad se DERIVA y respeta la precision: con 'year' dice "aprox."
              porque el 01-01 guardado es relleno. formatPetAge es la misma
              funcion que usan las dos pantallas de web. */}
          {edadTexto !== '' && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('pet_detail:age')}</Text>
              <Text style={styles.detailValue}>{edadTexto}</Text>
            </View>
          )}
          {/* Zona only while still adoptable — a rehomed (adopted) pet needs no location. */}
          {pet.status === 'adoption' && pet.city && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('adoption:publish.cityLabel')}</Text>
              <Text style={styles.detailValue}>{pet.city}</Text>
            </View>
          )}
          {latestReport?.location_description && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('pet_detail:lastLocation')}</Text>
              <Text style={styles.detailValue}>{latestReport.location_description}</Text>
            </View>
          )}
        </View>

        {vistoPorUltimaVez && (
          <View style={styles.lastSeen} testID="last-seen">
            <Text style={styles.lastSeenRelative}>{vistoPorUltimaVez.relative}</Text>
            <Text style={styles.lastSeenAbsolute}>{vistoPorUltimaVez.absolute}</Text>
          </View>
        )}

        {/* Descripción */}
        {pet.description && (
          <View style={styles.descriptionCard}>
            <Text style={styles.sectionTitle}>{t('pet_detail:description')}</Text>
            <Text style={styles.descriptionText}>{pet.description}</Text>
          </View>
        )}

        {isAdoptionListing && <AdoptionPetBody pet={pet} />}
        {!isAdoptionListing && (
          <>
        {/* Botón Marcar como encontrada — owner cuando está lost, reporter cuando es stray */}
        {canManage && (pet.status === 'lost' || pet.status === 'stray') && (
          <TouchableOpacity
            style={[styles.markFoundButton, markAsFound.isPending && styles.disabledButton]}
            onPress={openFoundPicker}
            disabled={markAsFound.isPending}
            activeOpacity={0.8}
          >
            {markAsFound.isPending ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <IconLabel icon="check-circle" size={18} color={colors.onPrimary}>
                <Text style={styles.markFoundButtonText}>{t('pet_detail:markAsFound')}</Text>
              </IconLabel>
            )}
          </TouchableOpacity>
        )}

        {/* Botón Contar historia — para quien gestiona la mascota (dueño o, en
            un stray, el reporter) cuando ya fue encontrada */}
        {canManage && pet.status === 'found' && (
          <TouchableOpacity
            style={styles.storyButton}
            onPress={() => router.push(`/story/create?petId=${pet.id}`)}
            activeOpacity={0.8}
          >
            <IconLabel icon="celebration" size={18} color={colors.onPrimary}>
              <Text style={styles.storyButtonText}>{t('story:create')}</Text>
            </IconLabel>
          </TouchableOpacity>
        )}

        {/* Dueño */}
        {pet.owner && (
          <View style={styles.ownerCard}>
            <Text style={styles.sectionTitle}>{t('pet_detail:ownerContact')}</Text>
            <View style={styles.ownerInfo}>
              <View style={styles.ownerAvatar}>
                <Icon name="person" size={24} color={colors.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                {/* The public profile needs no session, so this is always a
                    link: it lets a stranger be checked (reviews, badges,
                    other posts) before anyone gets in touch. */}
                <TouchableOpacity
                  onPress={() => pet.owner && router.push(`/users/${pet.owner.id}`)}
                  accessibilityRole="link"
                >
                  <Text style={styles.ownerName}>{pet.owner.name}</Text>
                </TouchableOpacity>
                {pet.owner.is_verified && (
                  <Text style={styles.verifiedText}>{t('pet_detail:verified')}</Text>
                )}
              </View>
              {!isOwner && (
                <TouchableOpacity
                  // This block only renders with an owner, but TypeScript does
                  // not carry that narrowing into the callback, hence the check.
                  onPress={() => pet.owner && showKebabSheet(pet.owner.id, pet.id)}
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

        {/* Avistamientos: el mapa y el timeline salen de LA MISMA consulta, así
            que van bajo UN solo `ListState` — una falla, un cartel. Con
            `reports ?? []` el mapa se dibujaba vacío cuando la consulta fallaba,
            o sea "nadie la vio", que es la pregunta entera de esta pantalla en
            una app para encontrar mascotas perdidas.

            El timeline de texto sí se escondía solo, y eso NO era el bug: un
            bloque que no aparece no afirma nada. El mapa vacío sí afirma.

            `errorTitle` nombra la SECCIÓN y no la causa. El título por defecto
            dice "no pudimos cargar esta lista", que se entiende solo donde la
            lista ES la página; acá el cartel aterriza en medio de un detalle
            cuya foto, datos y contacto cargaron bien. Mismo criterio que la web.

            `loading={<></>}`: el resto de la pantalla ya está dibujado y un
            spinner suelto acá sólo agregaría ruido. */}
        <ListState<Report[], Report>
          query={reportsQuery}
          errorTitle={t('pets:detail.timelineLoadError')}
          loading={<></>}
        >
          {(reports) => (
            <>
              <TimelineMap reports={reports} />

              {/* Timeline de reportes */}
              {reports.length > 0 && (
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
                      // `hour: 'numeric'` y no `'2-digit'`: `es-UY` es un reloj
                      // de 12 horas y el cero a la izquierda da `03:04 p. m.`.
                      // Mobile viene con `es-UY` desde siempre, así que acá el
                      // defecto estuvo todo el tiempo — se veía sólo porque
                      // nadie miraba esta línea al lado de la de web. Es la
                      // MISMA pantalla que `web/PetDetailPage`.
                      hour: 'numeric',
                      minute: '2-digit',
                    });

                    return (
                      <View key={report.id} style={styles.timelineItem}>
                        <View style={[
                          styles.timelineDot,
                          { backgroundColor: report.status === 'found' ? colors.found : report.status === 'sighting' ? colors.sighting : colors.lost },
                        ]} />
                        {index < reports.length - 1 && <View style={styles.timelineLine} />}
                        <View style={styles.timelineContent}>
                          <Text style={styles.timelineStatus}>
                            {report.status === 'lost' ? t('pets:status.lost') : report.status === 'found' ? t('pets:status.found') : t('map:legendSighting')}
                          </Text>
                          {report.is_verified && (
                            <IconLabel icon="check" size={13} color="#16a34a" gap={2} style={{ marginTop: 2 }}>
                              <Text style={[styles.verifiedBadge, { marginTop: 0 }]}>{t('pet_detail:verified')}</Text>
                            </IconLabel>
                          )}
                          {report.location_description && (
                            <IconLabel icon="location-on" size={12} color={colors.textSecondary} gap={2} style={{ marginTop: 2 }}>
                              <Text style={[styles.timelineLocation, { marginTop: 0, flexShrink: 1 }]}>
                                {report.location_description}
                              </Text>
                            </IconLabel>
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
            </>
          )}
        </ListState>
          </>
        )}

        <View style={{ height: 80 }} />
      </View>
      {pickerOpen && (
        <HelperPickerModal
          petId={pet.id}
          petName={pet.name}
          loading={markAsFound.isPending}
          error={foundError}
          onConfirm={confirmFound}
          onCancel={() => setPickerOpen(false)}
        />
      )}
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
  notFoundText: {
    fontSize: FONTS.sizes.lg,
    color: c.textSecondary,
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
    backgroundColor: c.white,
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: c.background,
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
    color: c.onPrimary,
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
  petName: { fontSize: FONTS.sizes.xxl, fontWeight: '700', color: c.textPrimary, flex: 1 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.sm },
  statusText: { color: c.onPrimary, fontSize: 12, fontWeight: '800' },
  detailsCard: {
    backgroundColor: c.card,
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
    borderBottomColor: c.border,
  },
  detailLabel: { fontSize: FONTS.sizes.sm, color: c.textSecondary, fontWeight: '500' },
  detailValue: { fontSize: FONTS.sizes.sm, color: c.textPrimary, fontWeight: '600' },
  lastSeen: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
  },
  lastSeenRelative: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
  lastSeenAbsolute: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  descriptionCard: {
    backgroundColor: c.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: c.textPrimary,
    marginBottom: SPACING.sm,
  },
  descriptionText: { fontSize: FONTS.sizes.sm, color: c.textSecondary, lineHeight: 22 },
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
    color: c.onPrimary,
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
    color: c.onPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  ownerCard: {
    backgroundColor: c.card,
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
    backgroundColor: c.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  ownerName: { fontSize: FONTS.sizes.md, fontWeight: '600', color: c.textPrimary },
  verifiedText: { fontSize: FONTS.sizes.xs, color: c.success, fontWeight: '600', marginTop: 2 },
  contactButton: {
    backgroundColor: c.whatsapp,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  contactButtonText: { color: c.onPrimary, fontSize: FONTS.sizes.md, fontWeight: '700' },
  kebabIcon: { fontSize: 22, color: c.textSecondary, paddingHorizontal: 4 },
  timelineCard: {
    backgroundColor: c.card,
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
    backgroundColor: c.border,
  },
  timelineContent: { flex: 1 },
  timelineStatus: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: c.textPrimary },
  verifiedBadge: { fontSize: 11, color: '#16a34a', fontWeight: '700', marginTop: 2 },
  timelineLocation: { fontSize: FONTS.sizes.xs, color: c.textSecondary, marginTop: 2 },
  timelineDate: { fontSize: FONTS.sizes.xs, color: c.textMuted, marginTop: 2 },
});
