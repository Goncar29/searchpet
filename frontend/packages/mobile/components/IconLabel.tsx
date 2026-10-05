import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';
import { SPACING } from '../constants';

interface IconLabelProps {
  icon: IconName;
  /** Pass the color of the text next to it so the pair reads as one. */
  color: string;
  size?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}

/**
 * A registry icon followed by a label, on one row. Replaces the
 * `<Text>{emoji} {label}</Text>` pattern: an SVG cannot live inside a `<Text>`
 * string, so the pair becomes a row with an `Icon` and a `Text` child.
 */
export function IconLabel({ icon, color, size = 16, gap = SPACING.xs, style, testID, children }: IconLabelProps) {
  return (
    <View testID={testID} style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>
      <Icon name={icon} size={size} color={color} />
      {children}
    </View>
  );
}
