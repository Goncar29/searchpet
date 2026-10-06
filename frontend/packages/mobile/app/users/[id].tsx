// ============================================================
// SearchPet — Perfil Público
// Muestra el perfil público de otro usuario: stats + badges + reseñas.
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Alert,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { usePublicProfile, useUserPets, useUserReviews, useCreateReview, useUpdateReview, useDeleteReview, useBlockUser, useBlockedUsers, useSubmitAbuseReport } from '../../../shared/hooks';
import { getErrorMessage } from '../../../shared/utils/apiErrors';
import { useAuthStore } from '../../store';
import { SPACING, FONTS, RADIUS, SHADOWS, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { StaleDataNotice, ListState } from '../../components/list/ListState';
import { PetCard } from '../../components/PetCard';
import { getDateLocale } from '../../i18n/dateLocale';
import type { Badge, Pet, UserReview } from '../../../shared/types';
import { splitOwnedPets } from '../../../shared/utils/ownedPetBuckets';
import { BADGE_META, BADGE_FALLBACK_ICON } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { IconLabel } from '../../components/IconLabel';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';
import { IMAGE_SIZES } from '../../constants/imageSizes';

// ============================================================
// Helpers
// ============================================================

function getInitials(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

function formatDate(dateString: string, lang: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(getDateLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' });
}

// ============================================================
// Sub-components
// ============================================================

function BadgeRow({ badge }: { badge: Badge }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation(['badges', 'users']);
  const meta = BADGE_META[badge.badge_type] ?? {
    icon: BADGE_FALLBACK_ICON,
    labelKey: badge.badge_type,
    descriptionKey: '',
  };
  const label = t(meta.labelKey);
  const description = meta.descriptionKey ? t(meta.descriptionKey) : '';

  return (
    <View style={styles.badgeCard}>
      <View style={styles.badgeIcon}>
        <Icon name={meta.icon} size={36} color={colors.primary} />
      </View>
      <View style={styles.badgeInfo}>
        <Text style={styles.badgeLabel}>{label}</Text>
        {description ? (
          <Text style={styles.badgeDescription}>{description}</Text>
        ) : null}
        <Text style={styles.badgeDate}>{t('users:earnedOn')}{formatDate(badge.earned_at, i18n.language)}</Text>
      </View>
    </View>
  );
}

interface StatItemProps {
  value: number;
  label: string;
}

function StatItem({ value, label }: StatItemProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

interface StarDisplayProps {
  stars: number;
  size?: number;
}

function StarDisplay({ stars, size = 14 }: StarDisplayProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('users');
  return (
    <View
      style={styles.starRow}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('users:starCount', { count: stars })}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon
          key={i}
          name={i <= stars ? 'star-filled' : 'star'}
          size={size}
          color={i <= stars ? colors.accent : colors.placeholder}
        />
      ))}
    </View>
  );
}

interface StarSelectorProps {
  value: number;
  onChange: (stars: number) => void;
}

function StarSelector({ value, onChange }: StarSelectorProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('users');
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <TouchableOpacity
          key={i}
          onPress={() => onChange(i)}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={t('users:starCount', { count: i })}
        >
          <Icon
            name={i <= value ? 'star-filled' : 'star'}
            size={32}
            color={i <= value ? colors.accent : colors.placeholder}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

interface ReviewCardProps {
  review: UserReview;
  onDelete?: () => void;
}

function ReviewCard({ review, onDelete }: ReviewCardProps) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('users');
  const initials = review.reviewer_name.trim().charAt(0).toUpperCase();

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        {review.reviewer_photo ? (
          <Image source={{ uri: cloudinaryThumb(review.reviewer_photo, IMAGE_SIZES.avatarSm) }} style={styles.reviewAvatar} />
        ) : (
          <View style={styles.reviewAvatarInitials}>
            <Text style={styles.reviewAvatarText}>{initials}</Text>
          </View>
        )}
        <View style={styles.reviewMeta}>
          <Text style={styles.reviewerName}>{review.reviewer_name}</Text>
          <StarDisplay stars={review.stars} />
        </View>
        <View style={styles.reviewDateCol}>
          <Text style={styles.reviewDate}>{formatDate(review.created_at, i18n.language)}</Text>
          {onDelete && (
            <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.deleteReviewText}>{t('users:deleteReview')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {review.text ? (
        <Text style={styles.reviewText}>{review.text}</Text>
      ) : null}
    </View>
  );
}

// ============================================================
// Main screen
// ============================================================

export default function PublicProfileScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, isAuthenticated } = useAuthStore();
  const navigation = useNavigation();
  const router = useRouter();
  const { t } = useTranslation(['users', 'badges', 'common']);

  const profileQuery = usePublicProfile(id ?? '');
  const { data: profile, isLoading, isError, refetch, isFetching } = profileQuery;
  const { data: reviewsData, isLoading: reviewsLoading } = useUserReviews(id ?? '');
  const petsQuery = useUserPets(id ?? '');

  const [showForm, setShowForm] = useState(false);
  const [formStars, setFormStars] = useState(0);
  const [formText, setFormText] = useState('');

  const createReview = useCreateReview(id ?? '');
  const updateReview = useUpdateReview(id ?? '');
  const deleteReview = useDeleteReview();

  const blockUser = useBlockUser();
  const submitAbuseReport = useSubmitAbuseReport();
  const { data: blockedList } = useBlockedUsers();

  const reviews = reviewsData?.reviews ?? [];
  const isOwnProfile = !!user && user.id === id;
  const canReview = isAuthenticated && !isOwnProfile;
  const isBlocked = blockedList?.some((b) => b.blocked_id === id) ?? false;

  // `mostradas` y `total` describen el MISMO conjunto (todo lo publicado y no
  // cerrado, las dos secciones juntas); no se compara contra una sola sección.
  // `>` y NO `!==`: `X-Total-Count` es best-effort y el cliente cae a 0 si falta,
  // lo que dejaría "3 de 0" con `!==`. Con la query caída ambos son 0 y el aviso
  // no afirma nada sobre una lista que no se pudo leer.
  const petsShown = petsQuery.data?.data.length ?? 0;
  const petsTotal = petsQuery.data?.total ?? 0;
  const petsTruncated = petsTotal > petsShown;
  const adoptionPets = petsQuery.data ? splitOwnedPets(petsQuery.data.data).adoption : [];

  const handleDeleteReview = () => {
    Alert.alert(
      i18next.t('users:deleteReviewTitle'),
      i18next.t('users:deleteReviewConfirm'),
      [
        { text: i18next.t('users:cancel'), style: 'cancel' },
        {
          text: i18next.t('users:deleteReview'),
          style: 'destructive',
          onPress: () => {
            deleteReview.mutate(id ?? '', {
              onSuccess: () => Alert.alert(i18next.t('users:deleteReviewSuccess')),
              onError: (err) => Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key))),
            });
          },
        },
      ],
    );
  };

  const handleBlockUser = () => {
    blockUser.mutate(
      { userId: id ?? '' },
      {
        onSuccess: () => {
          Alert.alert(i18next.t('users:blockUserSuccess'), i18next.t('users:blockUserSuccessText'));
        },
        onError: (err: unknown) => {
          Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
        },
      },
    );
  };

  const handleReportUser = () => {
    const reasons: { label: string; value: string }[] = [
      { label: 'Spam', value: 'spam' },
      { label: i18next.t('pet_detail:fake'), value: 'fake' },
      { label: i18next.t('pet_detail:abuse'), value: 'abuse' },
      { label: i18next.t('pet_detail:inappropriate'), value: 'inappropriate' },
      { label: i18next.t('pet_detail:other'), value: 'other' },
    ];
    Alert.alert(
      i18next.t('users:reportReason'),
      '',
      [
        ...reasons.map((r) => ({
          text: r.label,
          onPress: () => {
            submitAbuseReport.mutate(
              { target_user_id: id ?? '', reason: r.value as 'spam' | 'fake' | 'abuse' | 'inappropriate' | 'other' },
              {
                onSuccess: () => Alert.alert(i18next.t('users:reportSuccess'), i18next.t('users:reportSuccessText')),
                onError: (err: unknown) => Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t)),
              },
            );
          },
        })),
        { text: i18next.t('users:optionsCancel'), style: 'cancel' },
      ],
    );
  };

  const showKebabSheet = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [i18next.t('users:optionsCancel'), i18next.t('users:optionsBlock'), i18next.t('users:optionsReport')],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 1,
        },
        (idx) => {
          if (idx === 1) handleBlockUser();
          if (idx === 2) handleReportUser();
        },
      );
    } else {
      Alert.alert(i18next.t('users:options'), '', [
        { text: i18next.t('users:optionsCancel'), style: 'cancel' },
        { text: i18next.t('users:optionsBlock'), style: 'destructive', onPress: handleBlockUser },
        { text: i18next.t('users:optionsReport'), onPress: handleReportUser },
      ]);
    }
  };

  // Wire kebab into header — only when viewing another user's profile.
  // navigation is stable (React Navigation guarantees identity across
  // re-renders). showKebabSheet is a plain function recreated every render,
  // but everything it closes over (route id, i18next.t, the stable mutate
  // refs behind handleBlockUser/handleReportUser) is effectively static for
  // the screen's lifetime — including it would only make this effect
  // re-run on every render for no behavioral gain.
  useEffect(() => {
    if (!isOwnProfile && isAuthenticated) {
      const headerRight = () => (
        <TouchableOpacity onPress={showKebabSheet} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ paddingRight: 16, fontSize: 22 }}>⋮</Text>
        </TouchableOpacity>
      );
      navigation.setOptions({ headerRight });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwnProfile, isAuthenticated, id]);

  // Find existing review by current user (reviewer_id matches user.id)
  const myReview = canReview
    ? reviews.find((r) => r.reviewer_id === user?.id)
    : undefined;

  const handleOpenForm = () => {
    if (myReview) {
      setFormStars(myReview.stars);
      setFormText(myReview.text);
    } else {
      setFormStars(0);
      setFormText('');
    }
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (formStars < 1 || formStars > 5) {
      Alert.alert(i18next.t('common:error'), i18next.t('users:starError'));
      return;
    }
    if (!formText.trim()) {
      Alert.alert(i18next.t('common:error'), i18next.t('users:commentError'));
      return;
    }

    const payload = { stars: formStars, text: formText.trim() };
    const action = myReview ? updateReview : createReview;

    action.mutate(payload, {
      onSuccess: () => {
        setShowForm(false);
        setFormStars(0);
        setFormText('');
      },
      onError: (err) => {
        Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
      },
    });
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // `!profile` y NO `isError || !profile`: React Query conserva lo cacheado
  // cuando falla un refetch, y esta pantalla tiene pull-to-refresh. Con el `||`,
  // un 502 pasajero de Render reemplazaba el perfil que el usuario estaba
  // mirando por un cartel de error. Ahora el cartel sale sólo cuando no hay
  // perfil que mostrar, y el texto de adentro sigue distinguiendo "no pudimos
  // leerlo" de "no existe" con el mismo `isError`.
  if (!profile) {
    return (
      <View style={styles.center}>
        <View style={styles.stateIcon}><Icon name="search" size={56} color={colors.textMuted} /></View>
        <Text style={styles.stateTitle}>{isError ? t('users:loadError') : t('users:notFound')}</Text>
        <Text style={styles.stateText}>
          {isError
            ? t('users:loadErrorText')
            : t('users:notFoundText')}
        </Text>
        {isError && (
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>{t('users:retry')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {/* Si el pull-to-refresh falló, el perfil ya no se borra (ver la guarda
          `!profile` de arriba) — pero sin esto el RefreshControl simplemente
          dejaría de girar y nada le diría al usuario que está viendo datos de
          hace un rato. Un error invisible en vez de uno falso sigue siendo un
          problema. */}
      <StaleDataNotice query={profileQuery} />

      {/* ── User card ── */}
      <View style={styles.userCard}>
        {profile.profile_photo_url ? (
          <Image
            source={{ uri: cloudinaryThumb(profile.profile_photo_url, IMAGE_SIZES.avatarMd) }}
            style={styles.photoAvatar}
          />
        ) : (
          <View style={styles.initialsAvatar}>
            <Text style={styles.initialsText}>{getInitials(profile.name)}</Text>
          </View>
        )}
        <Text style={styles.userName}>{profile.name}</Text>
        {profile.city ? (
          <IconLabel icon="location-on" size={14} color={colors.textSecondary} style={{ marginTop: 4 }}>
            <Text style={[styles.userCity, { marginTop: 0 }]}>{profile.city}</Text>
          </IconLabel>
        ) : null}
      </View>

      {/* ── Stats grid ── */}
      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          <StatItem value={profile.total_points} label={t('users:points')} />
          <View style={styles.statDivider} />
          <StatItem value={profile.total_reports} label={t('users:reports')} />
        </View>
        <View style={styles.statRowSeparator} />
        <View style={styles.statsRow}>
          <StatItem value={profile.found_count} label={t('users:found')} />
          <View style={styles.statDivider} />
          <StatItem value={profile.share_count} label={t('users:shared')} />
        </View>
      </View>

      {/* ── Rating summary ── */}
      <View style={styles.ratingCard}>
        <View style={styles.ratingRow}>
          <Text style={styles.ratingValue}>
            {profile.avg_rating > 0 ? profile.avg_rating.toFixed(1) : '—'}
          </Text>
          <StarDisplay stars={Math.round(profile.avg_rating)} size={18} />
          <Text style={styles.ratingCount}>
            {profile.review_count === 1
              ? t('users:reviewCount_one')
              : t('users:reviewCount_other', { count: profile.review_count })}
          </Text>
        </View>
      </View>

      {/* ── Badges ── */}
      <View style={styles.section}>
        <IconLabel icon="emoji-events" size={20} color={colors.textPrimary} gap={SPACING.sm} style={{ marginBottom: SPACING.md }}>
          <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>{t('users:achievements')}</Text>
        </IconLabel>

        {profile.badges.length === 0 ? (
          <View style={styles.emptyBadges}>
            <Icon name="military-tech" size={32} color={colors.textMuted} />
            <Text style={styles.emptyBadgesText}>{t('users:noBadges')}</Text>
          </View>
        ) : (
          profile.badges.map((badge) => (
            <BadgeRow key={badge.id} badge={badge} />
          ))
        )}
      </View>

      {/* ── Publicaciones ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('users:posts')}</Text>
        <ListState
          query={petsQuery}
          // El sobre es `{data, total}`: se atraviesa `.data` antes de partir.
          select={(paged) => splitOwnedPets(paged.data).owned}
          errorTitle={t('users:postsError')}
          loading={<ActivityIndicator testID="user-pets-loading" size="small" color={colors.primary} style={{ marginTop: SPACING.md }} />}
        >
          {(pets: Pet[]) =>
            pets.length === 0 ? (
              <View style={styles.emptyBadges}>
                <Icon name="pets" size={32} color={colors.textMuted} />
                <Text style={styles.emptyBadgesText}>{t('users:postsEmpty')}</Text>
              </View>
            ) : (
              pets.map((pet) => (
                <PetCard key={pet.id} pet={pet} onPress={() => router.push(`/pet/${pet.id}`)} />
              ))
            )
          }
        </ListState>
      </View>

      {/* En adopción: sin `ListState` propio A PROPÓSITO. Comparte query con
          "Publicaciones", que ya reporta la falla UNA vez; si acá no hay nada
          no se dibuja nada, y así no afirma "no tiene nada en adopción" con la
          lista caída. */}
      {adoptionPets.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('users:adoption')}</Text>
          {adoptionPets.map((pet) => (
            <PetCard key={pet.id} pet={pet} onPress={() => router.push(`/pet/${pet.id}`)} />
          ))}
        </View>
      )}

      {/* El aviso de recorte va DEBAJO de las dos secciones, y sólo cuando el
          tope muerde realmente. */}
      {petsTruncated && (
        <Text style={styles.petsCapped}>
          {t('users:postsCapped', { shown: petsShown, total: petsTotal })}
        </Text>
      )}

      {/* ── Blocked banner ── */}
      {isBlocked && (
        <View style={styles.blockedBanner}>
          <Text style={styles.blockedBannerText}>{t('users:blockedBanner')}</Text>
        </View>
      )}

      {/* ── Reviews section ── */}
      <View style={styles.section}>
        <View style={styles.reviewSectionHeader}>
          <IconLabel icon="star-filled" size={20} color={colors.accent} gap={SPACING.sm}>
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>{t('users:reviews')}</Text>
          </IconLabel>
          {canReview && (
            <TouchableOpacity
              style={styles.reviewButton}
              onPress={handleOpenForm}
            >
              <Text style={styles.reviewButtonText}>
                {myReview ? t('users:editReview') : t('users:leaveReview')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Inline review form */}
        {showForm && (
          <View style={styles.reviewForm}>
            <Text style={styles.formLabel}>{t('users:yourRating')}</Text>
            <StarSelector value={formStars} onChange={setFormStars} />
            <TextInput
              style={styles.formInput}
              placeholder={t('users:writeReview')}
              placeholderTextColor={colors.placeholder}
              multiline
              numberOfLines={4}
              value={formText}
              onChangeText={setFormText}
              maxLength={2000}
            />
            <View style={styles.formActions}>
              <TouchableOpacity
                style={styles.formCancelButton}
                onPress={() => setShowForm(false)}
              >
                <Text style={styles.formCancelText}>{t('users:cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.formSubmitButton,
                  (createReview.isPending || updateReview.isPending) && styles.formSubmitDisabled,
                ]}
                onPress={handleSubmit}
                disabled={createReview.isPending || updateReview.isPending}
              >
                {createReview.isPending || updateReview.isPending ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.formSubmitText}>
                    {myReview ? t('users:saveChanges') : t('users:postReview')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Reviews list */}
        {reviewsLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: SPACING.md }} />
        ) : reviews.length === 0 ? (
          <View style={styles.emptyBadges}>
            <Icon name="chat-bubble" size={32} color={colors.textMuted} />
            <Text style={styles.emptyBadgesText}>{t('users:noReviews')}</Text>
          </View>
        ) : (
          reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              onDelete={
                user && review.reviewer_id === user.id
                  ? handleDeleteReview
                  : undefined
              }
            />
          ))
        )}
      </View>

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },

  // ── States ──
  stateIcon: { marginBottom: SPACING.md },
  stateTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: c.textPrimary, marginBottom: SPACING.sm },
  stateText: { fontSize: FONTS.sizes.sm, color: c.textSecondary, textAlign: 'center', marginBottom: SPACING.lg },
  retryButton: {
    borderWidth: 1,
    borderColor: c.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: c.primary, fontSize: FONTS.sizes.sm, fontWeight: '600' },

  // ── User card ──
  userCard: {
    alignItems: 'center',
    backgroundColor: c.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    ...SHADOWS.md,
  },
  photoAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: SPACING.md,
  },
  initialsAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: c.secondary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  initialsText: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '700',
    color: c.secondary,
  },
  userName: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: c.textPrimary },
  userCity: { fontSize: FONTS.sizes.sm, color: c.textSecondary, marginTop: 4 },

  // ── Stats ──
  statsCard: {
    backgroundColor: c.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: SPACING.sm },
  statValue: { fontSize: FONTS.sizes.xxl, fontWeight: '700', color: c.primary },
  statLabel: { fontSize: FONTS.sizes.xs, color: c.textSecondary, marginTop: 4 },
  statDivider: { width: 1, height: 40, backgroundColor: c.border },
  statRowSeparator: { height: 1, backgroundColor: c.border, marginVertical: SPACING.xs },

  // ── Rating summary ──
  ratingCard: {
    backgroundColor: c.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  ratingValue: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: c.textPrimary,
  },
  ratingCount: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
  },

  // ── Section ──
  section: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: c.textPrimary,
    marginBottom: SPACING.md,
  },

  // ── Badge row ──
  badgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  badgeIcon: { marginRight: SPACING.md },
  badgeInfo: { flex: 1 },
  badgeLabel: { fontSize: FONTS.sizes.md, fontWeight: '700', color: c.textPrimary },
  badgeDescription: { fontSize: FONTS.sizes.sm, color: c.textSecondary, marginTop: 2 },
  badgeDate: { fontSize: FONTS.sizes.xs, color: c.textMuted, marginTop: 4 },

  petsCapped: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    textAlign: 'center',
  },

  // ── Empty ──
  emptyBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
    gap: SPACING.md,
  },
  emptyBadgesText: { fontSize: FONTS.sizes.sm, color: c.textSecondary },

  // ── Reviews section header ──
  reviewSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  reviewButton: {
    backgroundColor: c.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: RADIUS.md,
  },
  reviewButtonText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },

  // ── Review form ──
  reviewForm: {
    backgroundColor: c.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  formLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: c.textPrimary,
    marginBottom: SPACING.sm,
  },
  formInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    minHeight: 88,
    textAlignVertical: 'top',
    fontSize: FONTS.sizes.sm,
    color: c.textPrimary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  formActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  formCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  formCancelText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: c.textSecondary,
  },
  formSubmitButton: {
    flex: 2,
    backgroundColor: c.primary,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  formSubmitDisabled: {
    backgroundColor: c.primaryLight,
  },
  formSubmitText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
  },

  // ── Review card ──
  reviewCard: {
    backgroundColor: c.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  reviewAvatarInitials: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.secondary + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewAvatarText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: c.secondary,
  },
  reviewMeta: {
    flex: 1,
    gap: 2,
  },
  reviewerName: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: c.textPrimary,
  },
  reviewDateCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  reviewDate: {
    fontSize: FONTS.sizes.xs,
    color: c.textMuted,
  },
  deleteReviewText: {
    fontSize: FONTS.sizes.xs,
    color: c.danger,
    fontWeight: '600',
  },
  reviewText: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    lineHeight: 20,
    marginTop: SPACING.xs,
  },

  // ── Blocked banner ──
  blockedBanner: {
    backgroundColor: c.dangerSoftBg,
    borderWidth: 1,
    borderColor: c.dangerSoftBorder,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
  },
  blockedBannerText: {
    fontSize: FONTS.sizes.sm,
    color: c.dangerSoftText,
    fontWeight: '500',
  },
});
