// ============================================================
// SearchPet — draws the alerts raised with showAlert (components/appAlert).
//
// Mounted once in app/_layout.tsx. Same card as the menus (ModalCard):
// - every button except 'cancel' is a row; there is no limit of three;
// - a notice with no rows gets a single OK;
// - closing the card (X, outside, back) runs the 'cancel' button, or the
//   only button of a one-button notice, so a flow that navigates on OK
//   (account created → login) cannot be left behind by closing with the X.
// ============================================================

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import i18next from 'i18next';
import { type ThemeColors, SPACING, FONTS } from '../constants';
import { useThemedStyles } from '../hooks/useTheme';
import { ModalCard } from './ModalCard';
import { useCurrentAlert, dismissCurrentAlert, type AlertButton } from './appAlert';

export function AlertHost() {
  const styles = useThemedStyles(makeStyles);
  const alert = useCurrentAlert();
  if (!alert) return null;

  const rows: AlertButton[] = alert.buttons.filter((b) => b.style !== 'cancel');
  const cancel = alert.buttons.find((b) => b.style === 'cancel');
  const onDismiss = cancel?.onPress ?? (alert.buttons.length === 1 ? alert.buttons[0].onPress : undefined);
  // No rows: the cancel button itself if there is one ("OK" with
  // style 'cancel' still has to run its onPress), else a plain OK.
  const shown = rows.length > 0 ? rows : [cancel ?? { text: i18next.t('common:ok') }];

  // Remove the alert first: a button may raise the next one ("blocked"), and
  // that has to queue behind nothing.
  const run = (fn?: () => void) => {
    dismissCurrentAlert();
    fn?.();
  };

  return (
    <ModalCard
      // A new key per alert: the next queued one mounts fresh.
      key={alert.id}
      visible
      title={alert.title}
      message={alert.message}
      onClose={() => run(onDismiss)}
      closeLabel={i18next.t('common:close')}
      backdropTestID="app-alert-backdrop"
    >
      <View>
        {shown.map((button, i) => (
          <TouchableOpacity
            key={`${i}-${button.text}`}
            style={[styles.action, i > 0 && styles.actionDivider]}
            onPress={() => run(button.onPress)}
            accessibilityRole="button"
            accessibilityLabel={button.text}
          >
            <Text
              style={[
                styles.actionText,
                button.style === 'destructive' && styles.actionTextDestructive,
              ]}
            >
              {button.text}
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
