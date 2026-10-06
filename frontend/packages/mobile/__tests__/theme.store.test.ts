import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEME_KEY, parseThemePreference, useThemeStore } from '../store/theme';
import { resolveScheme } from '../hooks/useTheme';

describe('theme preference (S1, S2)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useThemeStore.setState({ preference: 'system', userChose: false });
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
    useThemeStore.setState({ preference: 'dark', userChose: false });
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

describe('theme preference failures', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useThemeStore.setState({ preference: 'system', userChose: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The Settings row calls setPreference without awaiting it: a failed save
  // must not become an unhandled rejection, and the choice still applies for
  // this session.
  it('a failed save still applies the choice and does not reject', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(useThemeStore.getState().setPreference('dark')).resolves.toBeUndefined();
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  // A choice made while the saved value is still being read wins over it.
  it('hydrate does not overwrite a choice the user already made', async () => {
    await AsyncStorage.setItem(THEME_KEY, 'light');
    let release!: () => void;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve('light'); }),
    );
    const hydrating = useThemeStore.getState().hydrate();
    await useThemeStore.getState().setPreference('dark');
    release();
    await hydrating;
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('a failed read falls back to System', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('io'));
    await expect(useThemeStore.getState().hydrate()).resolves.toBeUndefined();
    expect(useThemeStore.getState().preference).toBe('system');
  });
});
