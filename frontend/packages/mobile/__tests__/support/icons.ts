// Helpers to assert which registry icons a render drew, and that no emoji is
// left in its text. They read the drawn `Path` (`d`, `fill`) instead of a name,
// so a test fails if the wrong glyph is drawn or an emoji comes back.
import { Text } from 'react-native';
import { Path } from 'react-native-svg';
import type { RenderResult } from '@testing-library/react-native';
import { ICON_PATHS, type IconName } from '../../../shared/icons/paths';

export const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** Every glyph path drawn in the render, in tree order. */
export function drawnPaths(ui: RenderResult): string[] {
  return ui.UNSAFE_queryAllByType(Path).map((p) => p.props.d as string);
}

/** The registry names drawn, in tree order (unknown paths are skipped). */
export function drawnIcons(ui: RenderResult): IconName[] {
  const byPath = new Map<string, IconName>(Object.entries(ICON_PATHS).map(([name, d]) => [d, name as IconName]));
  return drawnPaths(ui).flatMap((d) => (byPath.has(d) ? [byPath.get(d) as IconName] : []));
}

/** The `fill` of each drawn path for one icon name. */
export function fillsOf(ui: RenderResult, name: IconName): string[] {
  return ui
    .UNSAFE_queryAllByType(Path)
    .filter((p) => p.props.d === ICON_PATHS[name])
    .map((p) => p.props.fill as string);
}

/** Text nodes (flattened to strings) that contain an emoji. */
export function emojiTexts(ui: RenderResult): string[] {
  return ui
    .UNSAFE_queryAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string').join(''))
    .filter((s) => EMOJI.test(s));
}
