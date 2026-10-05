// ============================================================
// THEME STORE — System / Light / Dark
// ============================================================
//
// The preference persists in AsyncStorage under the web's key so both apps
// speak the same language. `system` (the default) follows the phone through
// useColorScheme; `light` and `dark` override it until the user goes back to
// `system`.

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const THEME_KEY = 'searchpet-theme';

export type ThemePreference = 'system' | 'light' | 'dark';

const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

// Anything that is not a known preference (an old or corrupted value) reads as
// `system`, so a bad stored value can never lock the app in one theme.
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return PREFERENCES.includes(raw as ThemePreference) ? (raw as ThemePreference) : 'system';
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: 'system',
  setPreference: async (preference) => {
    set({ preference });
    await AsyncStorage.setItem(THEME_KEY, preference);
  },
  hydrate: async () => {
    const saved = await AsyncStorage.getItem(THEME_KEY);
    set({ preference: parseThemePreference(saved) });
  },
}));
