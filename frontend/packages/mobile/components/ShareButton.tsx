// ============================================================
// SearchPet - ShareButton Component
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
  ActivityIndicator,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import QRCode from 'react-native-qrcode-svg';
import { useGenerateShareLink } from '../../shared/hooks';
import { buildWhatsAppMessage } from '../../shared/utils/whatsappTemplates';
import { getExpiryInfo } from '../../shared/utils/shareExpiry';
import { shareStatusLabel } from '../utils/adoptionFraming';
import { getErrorMessage } from '../../shared/utils/apiErrors';
import { LIGHT_COLORS, type ThemeColors, SPACING, FONTS, RADIUS } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';
import { getDateLocale } from '../i18n/dateLocale';
import { showAlert } from './appAlert';

interface ShareButtonProps {
  petId: string;
  petName: string;
  petType: string;
  status: 'lost' | 'found' | 'sighting' | 'adoption';
  pet?: import('../../shared/types').Pet;
}

const PLATFORMS = [
  { key: 'whatsapp', label: 'WhatsApp', colorKey: 'whatsapp' },
  { key: 'instagram', label: 'Instagram', colorKey: 'instagram' },
  { key: 'facebook', label: 'Facebook', colorKey: 'facebook' },
  { key: 'twitter', label: 'Twitter/X', colorKey: 'twitter' },
] as const;

export function ShareButton({ petId, petName, petType, status, pet }: ShareButtonProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  // Toda la copy de compartir vive en `pets.share` de shared/i18n, que es de
  // donde ya la lee el SharePanel de web. Una sola fuente para las dos
  // plataformas: con dos, quien actualice una deja la otra con el texto viejo.
  const { t } = useTranslation(['pets']);
  const [isLoading, setIsLoading] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);
  const generateLink = useGenerateShareLink();
  const statusText = shareStatusLabel(pet?.status ?? status);

  // Generate the link once and cache it in state — all channels reuse the same token.
  const getOrGenerateLink = async (): Promise<string> => {
    if (shareUrl) return shareUrl;
    const result = await generateLink.mutateAsync({ petID: petId, data: {} });
    setShareUrl(result.share_url);
    setExpiresAt(result.expires_at);
    return result.share_url;
  };

  const handleShare = async (platform: string) => {
    setIsLoading(true);
    try {
      const url = await getOrGenerateLink();
      const petForMessage = pet ?? { name: petName, type: petType, status: status === 'found' ? 'found' as const : 'lost' as const };
      const message = buildWhatsAppMessage(petForMessage, url);

      if (platform === 'whatsapp') {
        await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
      } else if (platform === 'facebook') {
        await Linking.openURL(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
      } else if (platform === 'twitter') {
        await Linking.openURL(`https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`);
      } else if (platform === 'instagram') {
        showAlert(
          i18next.t('pets:share.instagramTitle'),
          i18next.t('pets:share.instagramBody'),
        );
      } else {
        await Share.share({ message, url, title: `${petName} - ${statusText}` });
      }
    } catch (error: unknown) {
      showAlert(i18next.t('common:error'), getErrorMessage(error, i18next.t));
    } finally {
      setIsLoading(false);
    }
  };

  const handleNativeShare = async () => {
    setIsLoading(true);
    try {
      const url = await getOrGenerateLink();
      const petForMessage = pet ?? { name: petName, type: petType, status: status === 'found' ? 'found' as const : 'lost' as const };
      const message = buildWhatsAppMessage(petForMessage, url);
      await Share.share({ message, url, title: `${petName} - ${statusText}` });
    } catch (error: unknown) {
      showAlert(i18next.t('common:error'), getErrorMessage(error, i18next.t));
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleQR = async () => {
    if (showQR) { setShowQR(false); return; }
    try {
      await getOrGenerateLink();
      setShowQR(true);
    } catch (err: unknown) {
      showAlert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
    }
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>{t('pets:share.generatingLink')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('pets:share.title')}</Text>
      <Text style={styles.subtitle}>{t('pets:share.subtitle')}</Text>

      <View style={styles.platformsRow}>
        {PLATFORMS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.platformButton, { backgroundColor: colors[p.colorKey] }]}
            onPress={() => handleShare(p.key)}
          >
            <Text style={styles.platformLabel}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.qrToggle} onPress={handleToggleQR} disabled={generateLink.isPending}>
        <Text style={styles.qrToggleText}>{showQR ? t('pets:share.hideQr') : t('pets:share.showQr')}</Text>
      </TouchableOpacity>

      {showQR && (
        <View style={styles.qrCard}>
          {generateLink.isPending ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : shareUrl ? (
            <>
              {/* Dark ink on literal white in BOTH themes: a QR with light
                  modules on a dark ground is inverted and many readers fail it. */}
              <QRCode value={shareUrl} size={200} color={LIGHT_COLORS.textPrimary} backgroundColor={colors.white} />
              <Text style={styles.qrLabel}>{petName}</Text>
              {(() => {
                const expiry = getExpiryInfo(expiresAt, pet?.status);
                if (!expiry.hasExpiry) return null;
                if (expiry.isExpired) {
                  return (
                    <Text style={styles.expiryExpired}>{i18next.t('pets:share.linkExpired')}</Text>
                  );
                }
                return (
                  <Text style={expiry.isWarning ? styles.expiryWarning : styles.expiryOk}>
                    {i18next.t('pets:share.expiresOn', {
                      date: expiry.expiresAt!.toLocaleDateString(getDateLocale(i18next.language), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }),
                    })}
                  </Text>
                );
              })()}
            </>
          ) : null}
        </View>
      )}

      <TouchableOpacity style={styles.moreButton} onPress={handleNativeShare}>
        <Text style={styles.moreText}>{t('pets:share.moreOptions')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  container: {
    padding: SPACING.md,
    backgroundColor: c.surface,
    borderRadius: RADIUS.lg,
    marginVertical: SPACING.sm,
  },
  title: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: c.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: FONTS.sizes.xs,
    color: c.textSecondary,
    marginBottom: SPACING.md,
  },
  loadingText: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  platformsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  platformButton: {
    flex: 1,
    minWidth: 70,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  platformLabel: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  moreButton: {
    marginTop: SPACING.md,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  moreText: {
    color: c.primary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  qrToggle: {
    alignSelf: 'center',
    marginTop: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  qrToggleText: {
    fontSize: FONTS.sizes.sm,
    color: c.primary,
    fontWeight: '600',
  },
  qrCard: {
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  qrLabel: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    fontWeight: '500',
  },
  expiryOk: {
    marginTop: SPACING.xs,
    fontSize: FONTS.sizes.xs,
    color: c.textSecondary,
  },
  expiryWarning: {
    marginTop: SPACING.xs,
    fontSize: FONTS.sizes.xs,
    color: '#f97316',
    fontWeight: '600',
  },
  expiryExpired: {
    marginTop: SPACING.xs,
    fontSize: FONTS.sizes.xs,
    color: c.danger,
    fontWeight: '600',
  },
});
