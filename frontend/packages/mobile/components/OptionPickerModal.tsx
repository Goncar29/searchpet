// ============================================================
// SearchPet — single-choice picker (theme, language).
//
// Replaces Alert.alert for these choices: on Android an Alert shows at most
// three buttons, so with three options the fourth (Cancel) was dropped, and it
// could not be dismissed by tapping outside. Same look as PointsRulesModal.
// It closes with the X, by tapping outside the card, or with the back button.
// ============================================================

import { Modal, View, Text, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { type ThemeColors, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';
import { Icon } from './Icon';

export interface PickerOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  visible: boolean;
  title: string;
  options: PickerOption<T>[];
  selected: T | undefined;
  onSelect: (value: T) => void;
  onClose: () => void;
  closeLabel: string;
}

export function OptionPickerModal<T extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  closeLabel,
}: Props<T>) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} testID="option-picker-backdrop">
        {/* Swallows taps on the card so only the backdrop closes it. */}
        <Pressable style={styles.card} onPress={() => {}} accessibilityRole="none">
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View accessibilityRole="radiogroup">
            {options.map((option, i) => {
              const isSelected = option.value === selected;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.option, i > 0 && styles.optionDivider]}
                  onPress={() => {
                    onSelect(option.value);
                    onClose();
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                    {option.label}
                  </Text>
                  {isSelected ? (
                    <View testID={`option-check-${option.value}`}>
                      <Icon name="check" size={22} color={colors.primary} />
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
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
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: SPACING.md,
    },
    optionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    optionText: { fontSize: FONTS.sizes.md, color: c.textPrimary },
    optionTextSelected: { fontWeight: '700', color: c.primary },
  });
