import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { DARK_COLORS, LIGHT_COLORS, type ThemeColors } from '../constants';
import { useThemeStore, type ThemePreference } from '../store/theme';

export type ColorScheme = 'light' | 'dark';

export interface Theme {
  /** What the user chose in Settings. */
  preference: ThemePreference;
  /** What is on screen: `system` already resolved against the phone. */
  scheme: ColorScheme;
  colors: ThemeColors;
}

export function resolveScheme(preference: ThemePreference, system: string | null | undefined): ColorScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

export function useTheme(): Theme {
  const preference = useThemeStore((s) => s.preference);
  const system = useColorScheme();
  const scheme = resolveScheme(preference, system);
  return { preference, scheme, colors: scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS };
}

/**
 * Builds a screen's styles from the active palette. Write the styles as a
 * factory next to the component — `const makeStyles = (c: ThemeColors) =>
 * StyleSheet.create({...})` — and call this hook in the component: a
 * StyleSheet built at module level is computed once and never follows dark
 * mode. The factory runs again only when the palette changes.
 */
export function useThemedStyles<T>(makeStyles: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => makeStyles(colors), [makeStyles, colors]);
}
