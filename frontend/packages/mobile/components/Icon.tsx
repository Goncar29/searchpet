import Svg, { Path } from 'react-native-svg';
import { ICON_PATHS, type IconName } from '../../shared/icons/paths';

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
export function Icon({ name, size = 24, color, testID, accessibilityLabel }: IconProps) {
  const a11y = accessibilityLabel
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
    : {
        accessible: false,
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} testID={testID} {...a11y}>
      <Path d={ICON_PATHS[name]} fill={color} />
    </Svg>
  );
}
