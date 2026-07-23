import { Logo } from './Logo';

interface PawPlaceholderProps {
  className?: string;
  /** Explicit fill for html2canvas contexts (defaults to the terracotta brand). */
  color?: string;
}

/**
 * Brand paw used as a placeholder for empty pet-photo slots and "no results"
 * empty states. Terracotta (the brand color) — it clears WCAG AA contrast where
 * a light gray would not.
 */
export function PawPlaceholder({ className = '', color }: PawPlaceholderProps) {
  return <Logo className={`text-primary ${className}`} color={color} />;
}
