// ============================================================
// SearchPet — "How points and badges work" popup.
//
// Every number comes from shared/constants/gamification (which documents the
// backend lines it mirrors) and goes into the copy by interpolation, so the text
// and the amounts cannot drift apart.
// ============================================================

import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BADGE_META } from '../../shared/types';
import { POINTS, BADGE_THRESHOLDS } from '../../shared/constants/gamification';
import { type ThemeColors, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';
import { Icon } from './Icon';

/** Badges whose condition carries a number; the rest read the same everywhere. */
const BADGE_THRESHOLD: Record<string, number> = {
  community_guardian: BADGE_THRESHOLDS.communityGuardianReports,
  super_finder: BADGE_THRESHOLDS.superFinderPets,
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** A list item with a drawn dot: a text glyph would trip the no-glyph guard. */
function Bullet({ text }: { text: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={[styles.item, styles.bulletText]}>{text}</Text>
    </View>
  );
}

export function PointsRulesModal({ visible, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation(['pointsRules', 'badges']);

  const earn = [
    t('pointsRules:earn.report', { points: POINTS.report }),
    t('pointsRules:earn.share', { points: POINTS.share }),
    t('pointsRules:earn.helper', { points: POINTS.helper }),
    t('pointsRules:earn.review', { points: POINTS.reviewReceived }),
  ];
  const notEarn = [
    t('pointsRules:notEarn.ownFound'),
    t('pointsRules:notEarn.helperOnce'),
    t('pointsRules:notEarn.reviewWritten'),
    t('pointsRules:notEarn.reviewDeleted', { points: POINTS.reviewReceived }),
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{t('pointsRules:title')}</Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('pointsRules:close')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>{t('pointsRules:earn.title')}</Text>
            {earn.map((text) => (
              <Bullet key={text} text={text} />
            ))}

            <Text style={styles.sectionTitle}>{t('pointsRules:notEarn.title')}</Text>
            {notEarn.map((text) => (
              <Bullet key={text} text={text} />
            ))}

            <Text style={styles.sectionTitle}>{t('pointsRules:badges.title')}</Text>
            {Object.entries(BADGE_META).map(([type, meta]) => {
              const threshold = BADGE_THRESHOLD[type];
              return (
                <View key={type} style={styles.badgeRow}>
                  <Text style={styles.badgeName}>{t(meta.labelKey)}</Text>
                  <Text style={styles.item}>
                    {threshold == null
                      ? t(`pointsRules:badges.${type}`)
                      : t(`pointsRules:badges.${type}`, { threshold })}
                  </Text>
                </View>
              );
            })}

            <Text style={styles.sectionTitle}>{t('pointsRules:ranking.title')}</Text>
            <Text style={[styles.item, styles.lastItem]}>{t('pointsRules:ranking.body')}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: c.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    maxHeight: '85%',
    ...SHADOWS.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  title: {
    flex: 1,
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: c.textPrimary,
    marginRight: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: c.textPrimary,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  item: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    marginBottom: SPACING.xs,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start' },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.textSecondary,
    marginTop: 7,
    marginRight: SPACING.sm,
  },
  bulletText: { flex: 1 },
  lastItem: { marginBottom: SPACING.sm },
  badgeRow: { marginBottom: SPACING.sm },
  badgeName: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: c.textPrimary },
});
