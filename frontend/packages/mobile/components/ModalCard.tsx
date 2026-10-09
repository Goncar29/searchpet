// ============================================================
// SearchPet — centered card on a dimmed backdrop.
//
// The shell shared by OptionPickerModal and ActionMenuModal: a titled card
// with an X, closed by the X, by tapping outside the card, or with the back
// button. Same look as PointsRulesModal.
// ============================================================

import type { ReactNode } from 'react';
import { Modal, View, Text, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { type ThemeColors, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';
import { Icon } from './Icon';

interface Props {
  visible: boolean;
  title: string;
  /** Optional line under the title, e.g. the question a confirmation asks. */
  message?: string;
  onClose: () => void;
  closeLabel: string;
  backdropTestID?: string;
  children: ReactNode;
}

export function ModalCard({
  visible,
  title,
  message,
  onClose,
  closeLabel,
  backdropTestID,
  children,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} testID={backdropTestID}>
        {/* Swallows taps on the card so only the backdrop closes it. */}
        <Pressable style={styles.card} onPress={() => {}} accessibilityRole="none">
          <View style={styles.headerRow}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {children}
        </Pressable>
      </Pressable>
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
      maxWidth: 420,
      ...SHADOWS.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
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
    message: {
      fontSize: FONTS.sizes.md,
      color: c.textSecondary,
      marginBottom: SPACING.sm,
    },
  });
