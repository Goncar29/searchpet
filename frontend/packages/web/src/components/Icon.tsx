import type { SVGProps } from 'react';
import { ICON_PATHS, type IconName } from '@shared/icons/paths';

export type { IconName };

/**
 * Material Symbols icons as inline SVG.
 *
 * The Stitch designs use the Material Symbols webfont from the Google Fonts
 * CDN. We ship the same glyphs as inline paths instead: no extra request, no
 * blank-square flash while the font downloads, and no CSP change. Paths come
 * from the Iconify `material-symbols` set (Apache 2.0).
 *
 * Icons are decorative by default (`aria-hidden`). When an icon is the only
 * content of a control, label the control itself — `aria-label` on the button,
 * never on the svg.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName;
};

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
