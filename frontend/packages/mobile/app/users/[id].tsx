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
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { usePublicProfile, useUserReviews, useCreateReview, useUpdateReview, useDeleteReview, useBlockUser, useBlockedUsers, useSubmitAbuseReport } from '../../../shared/hooks';
import { getErrorMessage } from '../../../shared/utils/apiErrors';
import { useAuthStore } from '../../store';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import { getDateLocale } from '../../i18n/dateLocale';
import type { Badge, UserReview } from '../../../shared/types';
import { BADGE_META } from '../../../shared/types';

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
  const { t, i18n } = useTranslation(['badges', 'users']);
  const meta = BADGE_META[badge.badge_type] ?? {
    emoji: '🏅',
    labelKey: badge.badge_type,
    descriptionKey: '',
  };
  const label = t(meta.labelKey);
  const description = meta.descriptionKey ? t(meta.descriptionKey) : '';

  return (
    <View style={styles.badgeCard}>
      <Text style={styles.badgeEmoji}>{meta.emoji}</Text>
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
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={{ fontSize: size, color: i <= stars ? COLORS.accent : COLORS.placeholder }}>
          ★
        </Text>
      ))}
    </View>
  );
}

interface StarSelectorProps {
  value: number;
  onChange: (stars: number) => void;
}

function StarSelector({ value, onChange }: StarSelectorProps) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <TouchableOpacity key={i} onPress={() => onChange(i)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <Text style={{ fontSize: 32, color: i <= value ? COLORS.accent : COLORS.placeholder }}>★</Text>
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
  const { t, i18n } = useTranslation('users');
  const initials = review.reviewer_name.trim().charAt(0).toUpperCase();

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        {review.reviewer_photo ? (
          <Image source={{ uri: review.reviewer_photo }} style={styles.reviewAvatar} />
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, isAuthenticated } = useAuthStore();
  const navigation = useNavigation();
  const { t, i18n } = useTranslation(['users', 'badges', 'common']);

  const { data: profile, isLoading, isError, refetch, isFetching } = usePublicProfile(id ?? '');
  const { data: reviewsData, isLoading: reviewsLoading } = useUserReviews(id ?? '');

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
        onError: () => {
          Alert.alert('Error', i18next.t('users:blockUserError'));
        },
      },
    );
  };

  const handleReportUser = () => {
    const reasons: Array<{ label: string; value: string }> = [
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
                onError: () => Alert.alert('Error', i18next.t('users:reportError')),
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

  // Wire kebab into header — only when viewing another user's profile
  useEffect(() => {
    if (!isOwnProfile && isAuthenticated) {
      const headerRight = () => (
        <TouchableOpacity onPress={showKebabSheet} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ paddingRight: 16, fontSize: 22 }}>⋮</Text>
        </TouchableOpacity>
      );
      navigation.setOptions({ headerRight });
    }
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
      Alert.alert('Error', i18next.t('users:starError'));
      return;
    }
    if (!formText.trim()) {
      Alert.alert('Error', i18next.t('users:commentError'));
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
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (isError || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.stateIcon}>🔍</Text>
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
          colors={[COLORS.primary]}
          tintColor={COLORS.primary}
        />
      }
    >
      {/* ── User card ── */}
      <View style={styles.userCard}>
        {profile.profile_photo_url ? (
          <Image
            source={{ uri: profile.profile_photo_url }}
            style={styles.photoAvatar}
          />
        ) : (
          <View style={styles.initialsAvatar}>
            <Text style={styles.initialsText}>{getInitials(profile.name)}</Text>
          </View>
        )}
        <Text style={styles.userName}>{profile.name}</Text>
        {profile.city ? (
          <Text style={styles.userCity}>📍 {profile.city}</Text>
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
        <Text style={styles.sectionTitle}>{t('users:achievements')}</Text>

        {profile.badges.length === 0 ? (
          <View style={styles.emptyBadges}>
            <Text style={styles.emptyBadgesIcon}>🏅</Text>
            <Text style={styles.emptyBadgesText}>{t('users:noBadges')}</Text>
          </View>
        ) : (
          profile.badges.map((badge) => (
            <BadgeRow key={badge.id} badge={badge} />
          ))
        )}
      </View>

      {/* ── Blocked banner ── */}
      {isBlocked && (
        <View style={styles.blockedBanner}>
          <Text style={styles.blockedBannerText}>{t('users:blockedBanner')}</Text>
        </View>
      )}

      {/* ── Reviews section ── */}
      <View style={styles.section}>
        <View style={styles.reviewSectionHeader}>
          <Text style={styles.sectionTitle}>{t('users:reviews')}</Text>
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
              placeholderTextColor={COLORS.placeholder}
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
                  <ActivityIndicator size="small" color={COLORS.white} />
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
          <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: SPACING.md }} />
        ) : reviews.length === 0 ? (
          <View style={styles.emptyBadges}>
            <Text style={styles.emptyBadgesIcon}>💬</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },

  // ── States ──
  stateIcon: { fontSize: 56, marginBottom: SPACING.md },
  stateTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  stateText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', marginBottom: SPACING.lg },
  retryButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: COLORS.primary, fontSize: FONTS.sizes.sm, fontWeight: '600' },

  // ── User card ──
  userCard: {
    alignItems: 'center',
    backgroundColor: COLORS.white,
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
    backgroundColor: COLORS.secondary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  initialsText: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  userName: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary },
  userCity: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4 },

  // ── Stats ──
  statsCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: SPACING.sm },
  statValue: { fontSize: FONTS.sizes.xxl, fontWeight: '700', color: COLORS.primary },
  statLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 4 },
  statDivider: { width: 1, height: 40, backgroundColor: COLORS.border },
  statRowSeparator: { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.xs },

  // ── Rating summary ──
  ratingCard: {
    backgroundColor: COLORS.white,
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
    color: COLORS.textPrimary,
  },
  ratingCount: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
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
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },

  // ── Badge row ──
  badgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  badgeEmoji: { fontSize: 40, marginRight: SPACING.md },
  badgeInfo: { flex: 1 },
  badgeLabel: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary },
  badgeDescription: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  badgeDate: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: 4 },

  // ── Empty ──
  emptyBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
    gap: SPACING.md,
  },
  emptyBadgesIcon: { fontSize: 32 },
  emptyBadgesText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },

  // ── Reviews section header ──
  reviewSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  reviewButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: RADIUS.md,
  },
  reviewButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },

  // ── Review form ──
  reviewForm: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  formLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  formInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    minHeight: 88,
    textAlignVertical: 'top',
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
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
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  formCancelText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  formSubmitButton: {
    flex: 2,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  formSubmitDisabled: {
    backgroundColor: COLORS.primaryLight,
  },
  formSubmitText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
  },

  // ── Review card ──
  reviewCard: {
    backgroundColor: COLORS.white,
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
    backgroundColor: COLORS.secondary + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewAvatarText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  reviewMeta: {
    flex: 1,
    gap: 2,
  },
  reviewerName: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  reviewDateCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  reviewDate: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
  },
  deleteReviewText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.danger,
    fontWeight: '600',
  },
  reviewText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginTop: SPACING.xs,
  },

  // ── Blocked banner ──
  blockedBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
  },
  blockedBannerText: {
    fontSize: FONTS.sizes.sm,
    color: '#dc2626',
    fontWeight: '500',
  },
});
