import Svg, { Circle, Ellipse } from 'react-native-svg';

interface LogoProps {
  size?: number;
  color?: string;
  testID?: string;
}

/**
 * SearchPet brand mark ("Rastro"): a paw print preceded by a trail of steps.
 * Coordinates are pre-flattened (no nested transforms) so react-native-svg
 * renders them reliably. Matches the web favicon / Logo geometry.
 */
export function Logo({ size = 28, color = '#C24E1A', testID }: LogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 130 130" testID={testID} accessibilityLabel="SearchPet">
      {/* trail of steps */}
      <Circle cx={14} cy={102} r={4} fill={color} />
      <Circle cx={32} cy={92} r={5.5} fill={color} />
      <Circle cx={51} cy={81} r={7} fill={color} />
      {/* paw print */}
      <Ellipse cx={92} cy={81.26} rx={19.55} ry={16.15} fill={color} />
      <Circle cx={68.2} cy={63.41} r={8.075} fill={color} />
      <Circle cx={83.5} cy={50.66} r={8.925} fill={color} />
      <Circle cx={100.5} cy={50.66} r={8.925} fill={color} />
      <Circle cx={115.8} cy={63.41} r={8.075} fill={color} />
    </Svg>
  );
}
