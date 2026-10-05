import Svg, { Path } from 'react-native-svg';
import { ICON_PATHS, type IconName } from '../../shared/icons/paths';
import { useTheme } from '../hooks/useTheme';

export type { IconName };

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * Icon from the registry shared with web (`shared/icons/paths.ts`): one
 * 24x24 single-path glyph. Decorative by default (hidden from screen readers);
 * pass `accessibilityLabel` only when the icon is the sole content of a control
 * and the control itself isn't labelled.
 */
// Without a fill react-native-svg paints black, unlike the web's currentColor.
export function Icon({
  name,
  size = 24,
  color,
  testID,
  accessibilityLabel,
}: IconProps) {
  // The default follows the theme: an icon without an explicit color reads as text.
  const { colors } = useTheme();
  const fill = color ?? colors.textPrimary;
  const a11y = accessibilityLabel
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
    : {
        accessible: false,
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} testID={testID} {...a11y}>
      <Path d={ICON_PATHS[name]} fill={fill} />
    </Svg>
  );
}
