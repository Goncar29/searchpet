import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEME_KEY, parseThemePreference, useThemeStore } from '../store/theme';
import { resolveScheme } from '../hooks/useTheme';

describe('theme preference (S1, S2)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useThemeStore.setState({ preference: 'system' });
  });

  it('starts on System', () => {
    expect(useThemeStore.getState().preference).toBe('system');
  });

  it('persists the choice under the web key', async () => {
    await useThemeStore.getState().setPreference('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(await AsyncStorage.getItem(THEME_KEY)).toBe('dark');
    expect(THEME_KEY).toBe('searchpet-theme');
  });

  it('restores a saved choice on hydrate', async () => {
    await AsyncStorage.setItem(THEME_KEY, 'light');
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().preference).toBe('light');
  });

  it('reads an unknown or missing stored value as System', async () => {
    useThemeStore.setState({ preference: 'dark' });
    await AsyncStorage.setItem(THEME_KEY, 'sepia');
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().preference).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
  });
});

describe('resolveScheme', () => {
  it('System follows the phone, and an unknown phone scheme reads as light', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
  });

  it('Light and Dark override the phone', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});
