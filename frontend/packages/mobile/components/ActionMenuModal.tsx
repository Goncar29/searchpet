// ============================================================
// SearchPet — menu of actions (chat ⋮, report reasons, confirmations).
//
// Replaces Alert.alert for these menus: on Android an Alert shows at most
// three buttons, so the chat ⋮ (Cancel + three actions) dropped Report and the
// report reasons (five + Cancel) dropped most reasons. There is no Cancel row:
// the X, the backdrop and the back button all close it.
// ============================================================

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { type ThemeColors, SPACING, FONTS } from '../constants';
import { useThemedStyles } from '../hooks/useTheme';
import { ModalCard } from './ModalCard';

export interface MenuAction {
  key: string;
  label: string;
  onPress: () => void;
  /** Painted in the danger color: blocking someone, signing out. */
  destructive?: boolean;
}

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  actions: MenuAction[];
  onClose: () => void;
  closeLabel: string;
}

export function ActionMenuModal({ visible, title, message, actions, onClose, closeLabel }: Props) {
  const styles = useThemedStyles(makeStyles);

  return (
    <ModalCard
      visible={visible}
      title={title}
      message={message}
      onClose={onClose}
      closeLabel={closeLabel}
      backdropTestID="action-menu-backdrop"
    >
      <View>
        {actions.map((action, i) => (
          <TouchableOpacity
            key={action.key}
            style={[styles.action, i > 0 && styles.actionDivider]}
            // Close first: an action may open the next menu (Report opens the
            // reasons), and that has to land after this one is gone.
            onPress={() => {
              onClose();
              action.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Text style={[styles.actionText, action.destructive && styles.actionTextDestructive]}>
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ModalCard>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    action: { paddingVertical: SPACING.md },
    actionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    actionText: { fontSize: FONTS.sizes.md, color: c.textPrimary },
    actionTextDestructive: { fontWeight: '600', color: c.danger },
  });
