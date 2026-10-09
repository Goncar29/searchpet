// The in-app update notice: on Android, when GitHub has a newer release than
// the installed APK, a card offers the download. Once per version: closing it
// (or downloading) records that version, so it does not come back until the
// next release.
import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UpdateNotice, UPDATE_SEEN_KEY } from '../components/UpdateNotice';
import { APK_DOWNLOAD_URL } from '../utils/updateCheck';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.0' } },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'version' in opts ? `${key}:${opts.version}` : key,
  }),
}));

let fetchSpy: jest.SpyInstance;
let openSpy: jest.SpyInstance;

function latestRelease(tag: string) {
  fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve({ tag_name: tag }) });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.replaceProperty(Platform, 'OS', 'android');
  fetchSpy = jest.spyOn(global, 'fetch' as never);
  // Linking.openURL is already a jest.fn in React Native's jest setup, so
  // spyOn hands back that same mock and restoreAllMocks keeps its calls:
  // without the clear, the previous test's download leaks into this one.
  openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  openSpy.mockClear();
});

afterEach(() => jest.restoreAllMocks());

// Lets the whole check finish (fetch, then the AsyncStorage read) before a test
// asserts that nothing showed. Asserting right after the fetch passed even with
// the "already seen" guard deleted: the read had not happened yet.
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

describe('UpdateNotice', () => {
  it('con una versión más nueva, la ofrece', async () => {
    latestRelease('v1.3.0');
    render(<UpdateNotice />);

    expect(await screen.findByText('update:title')).toBeTruthy();
    expect(screen.getByText('update:message:1.3.0')).toBeTruthy();
  });

  it('"Descargar" abre el APK y no lo vuelve a ofrecer para esa versión', async () => {
    latestRelease('v1.3.0');
    render(<UpdateNotice />);
    fireEvent.press(await screen.findByRole('button', { name: 'update:download' }));

    expect(openSpy).toHaveBeenCalledWith(APK_DOWNLOAD_URL);
    await waitFor(async () => expect(await AsyncStorage.getItem(UPDATE_SEEN_KEY)).toBe('1.3.0'));
    expect(screen.queryByText('update:title')).toBeNull();
  });

  it('cerrarlo tampoco lo vuelve a ofrecer para esa versión', async () => {
    latestRelease('v1.3.0');
    render(<UpdateNotice />);
    fireEvent.press(await screen.findByRole('button', { name: 'common:close' }));

    expect(openSpy).not.toHaveBeenCalled();
    await waitFor(async () => expect(await AsyncStorage.getItem(UPDATE_SEEN_KEY)).toBe('1.3.0'));
    expect(screen.queryByText('update:title')).toBeNull();
  });

  it('una versión ya vista no se ofrece; la siguiente sí', async () => {
    await AsyncStorage.setItem(UPDATE_SEEN_KEY, '1.3.0');
    latestRelease('v1.3.0');
    const first = render(<UpdateNotice />);
    await settle();
    expect(fetchSpy).toHaveBeenCalled();
    expect(screen.queryByText('update:title')).toBeNull();
    first.unmount();

    latestRelease('v1.4.0');
    render(<UpdateNotice />);
    expect(await screen.findByText('update:message:1.4.0')).toBeTruthy();
  });

  it('con la misma versión instalada no muestra nada', async () => {
    latestRelease('v1.2.0');
    render(<UpdateNotice />);
    await settle();
    expect(fetchSpy).toHaveBeenCalled();
    expect(screen.queryByText('update:title')).toBeNull();
  });

  it('sin red no muestra nada', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Network request failed'));
    render(<UpdateNotice />);
    await settle();
    expect(fetchSpy).toHaveBeenCalled();
    expect(screen.queryByText('update:title')).toBeNull();
  });

  it('en iOS ni siquiera consulta: el APK no se instala ahí', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    latestRelease('v1.3.0');
    render(<UpdateNotice />);
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('update:title')).toBeNull();
  });
});
