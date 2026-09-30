import { render } from '@testing-library/react';
import { createElement } from 'react';
import { Icon, type IconName } from '../components/Icon';

/** The `d` attribute an `<Icon name=... />` draws, so a test can tell which glyph rendered. */
export function iconPath(name: IconName): string | null | undefined {
  const { container, unmount } = render(createElement(Icon, { name }));
  const d = container.querySelector('path')?.getAttribute('d');
  unmount();
  return d;
}

/** Every glyph path drawn under `root`, in document order. */
export function drawnPaths(root: ParentNode): (string | null)[] {
  return [...root.querySelectorAll('svg path')].map((p) => p.getAttribute('d'));
}

/** Emoji render in each OS's color font and ignore `currentColor`. */
export const EMOJI = /\p{Extended_Pictographic}|[✓✕★]/u;
