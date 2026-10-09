// ============================================================
// SearchPet — "there is a new version" card, shown once per release.
//
// Android only: the APK is what installs there, and iOS would have nothing to
// download. Closing the card or downloading records the version, so it comes
// back only when a newer release exists. Any failure (no network, GitHub
// error) shows nothing.
// ============================================================

import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { ActionMenuModal } from './ActionMenuModal';
import { APK_DOWNLOAD_URL, fetchLatestVersion, isNewerVersion } from '../utils/updateCheck';

export const UPDATE_SEEN_KEY = 'update:seenVersion';

export function UpdateNotice() {
  const { t } = useTranslation(['update', 'common']);
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const current = Constants.expoConfig?.version;
    if (!current) return;

    let cancelled = false;
    (async () => {
      const found = await fetchLatestVersion();
      if (!found || !isNewerVersion(found, current)) return;
      // An unreadable "seen" offers the update again: a repeated notice is
      // better than a silently missing one.
      const seen = await AsyncStorage.getItem(UPDATE_SEEN_KEY).catch(() => null);
      if (seen === found || cancelled) return;
      setLatest(found);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (latest === null) return null;

  const dismiss = () => {
    AsyncStorage.setItem(UPDATE_SEEN_KEY, latest).catch((err) => {
      console.warn('[update] could not save the seen version', err);
    });
    setLatest(null);
  };

  return (
    <ActionMenuModal
      visible
      title={t('update:title')}
      message={t('update:message', { version: latest })}
      actions={[
        {
          key: 'download',
          label: t('update:download'),
          onPress: () => {
            Linking.openURL(APK_DOWNLOAD_URL).catch((err) => {
              console.warn('[update] could not open the download', err);
            });
          },
        },
      ]}
      onClose={dismiss}
      closeLabel={t('common:close')}
    />
  );
}
