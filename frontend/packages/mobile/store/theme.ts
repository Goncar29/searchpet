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
  /** True once the user picked a theme this session: hydrate must not undo it. */
  userChose: boolean;
  setPreference: (preference: ThemePreference) => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'system',
  userChose: false,
  // Never rejects: the Settings row calls it without awaiting. A failed save
  // still applies the choice for this session; it just will not survive a
  // restart.
  setPreference: async (preference) => {
    set({ preference, userChose: true });
    try {
      await AsyncStorage.setItem(THEME_KEY, preference);
    } catch (err) {
      console.warn('[theme] could not save the theme preference', err);
    }
  },
  // Never rejects either: a failed read keeps System. And a choice the user made
  // while the saved value was still loading wins over that value.
  hydrate: async () => {
    let saved: string | null = null;
    try {
      saved = await AsyncStorage.getItem(THEME_KEY);
    } catch (err) {
      console.warn('[theme] could not read the theme preference', err);
    }
    if (!get().userChose) set({ preference: parseThemePreference(saved) });
  },
}));
