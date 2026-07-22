import { Logo } from './Logo';

interface PawPlaceholderProps {
  size?: number;
  color?: string;
  testID?: string;
}

/**
 * Brand paw used as a placeholder for empty pet-photo slots and "no results"
 * empty states. Terracotta (the brand color) — clears WCAG AA contrast.
 */
export function PawPlaceholder({ size = 48, color = '#C24E1A', testID = 'paw-placeholder' }: PawPlaceholderProps) {
  return <Logo size={size} color={color} testID={testID} />;
}
