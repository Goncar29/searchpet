interface LogoProps {
  className?: string;
  /**
   * Explicit fill color. Defaults to `currentColor` (inherit the text color).
   * Pass an explicit color for contexts rasterized by html2canvas (flyer, share
   * image), where `currentColor` does not resolve reliably.
   */
  color?: string;
  /**
   * Crop the viewBox tight to the mark (no square padding). Use inline next to
   * text so the paw reads at the text's size; the default padded square suits
   * standalone marks (favicon, app icon, centered heroes).
   */
  tight?: boolean;
}

/**
 * SearchPet brand mark ("Rastro"): a paw print preceded by a trail of steps.
 * Single-color — inherits `currentColor`, so control it with a text color class.
 */
export function Logo({ className = '', color, tight = false }: LogoProps) {
  return (
    <svg
      viewBox={tight ? '6 38 122 72' : '0 0 130 130'}
      className={className}
      fill={color ?? 'currentColor'}
      role="img"
      aria-label="SearchPet"
    >
      <g transform="translate(4,20)">
        <circle cx="10" cy="82" r="4" />
        <circle cx="28" cy="72" r="5.5" />
        <circle cx="47" cy="61" r="7" />
        <g transform="translate(44.65,6.86) scale(0.85)">
          <ellipse cx="51" cy="64" rx="23" ry="19" />
          <circle cx="23" cy="43" r="9.5" />
          <circle cx="41" cy="28" r="10.5" />
          <circle cx="61" cy="28" r="10.5" />
          <circle cx="79" cy="43" r="9.5" />
        </g>
      </g>
    </svg>
  );
}
