// ============================================================
// SearchPet — single-choice picker (theme, language).
//
// Replaces Alert.alert for these choices: on Android an Alert shows at most
// three buttons, so with three options the fourth (Cancel) was dropped, and it
// could not be dismissed by tapping outside. Same look as PointsRulesModal.
// The card itself (X, backdrop, back button) is ModalCard.
// ============================================================

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { type ThemeColors, SPACING, FONTS } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';
import { Icon } from './Icon';
import { ModalCard } from './ModalCard';

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
    <ModalCard
      visible={visible}
      title={title}
      onClose={onClose}
      closeLabel={closeLabel}
      backdropTestID="option-picker-backdrop"
    >
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
    </ModalCard>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
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
