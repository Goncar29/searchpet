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
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as Linking from 'expo-linking';
import i18next from 'i18next';
import QRCode from 'react-native-qrcode-svg';
import { useGenerateShareLink } from '../../shared/hooks';
import { buildWhatsAppMessage } from '../../shared/utils/whatsappTemplates';
import { getExpiryInfo } from '../../shared/utils/shareExpiry';
import { getErrorMessage } from '../../shared/utils/apiErrors';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';

interface ShareButtonProps {
  petId: string;
  petName: string;
  petType: string;
  status: 'lost' | 'found' | 'sighting';
  pet?: import('../../shared/types').Pet;
}

const PLATFORMS = [
  { key: 'whatsapp', label: 'WhatsApp', color: COLORS.whatsapp },
  { key: 'instagram', label: 'Instagram', color: COLORS.instagram },
  { key: 'facebook', label: 'Facebook', color: COLORS.facebook },
  { key: 'twitter', label: 'Twitter/X', color: COLORS.twitter },
] as const;

export function ShareButton({ petId, petName, petType, status, pet }: ShareButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);
  const generateLink = useGenerateShareLink();
  const statusText = status === 'found' ? 'ENCONTRADA' : 'PERDIDA';

  const handleShare = async (platform: string) => {
    setIsLoading(true);
    try {
      const result = await generateLink.mutateAsync({
        petID: petId,
        data: { platform: platform as any },
      });

      const petForMessage = pet ?? { name: petName, type: petType, status: status === 'found' ? 'found' as const : 'lost' as const };
      const message = buildWhatsAppMessage(petForMessage, result.share_url);

      if (platform === 'whatsapp') {
        const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
        await Linking.openURL(url);
      } else if (platform === 'facebook') {
        const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(result.share_url)}`;
        await Linking.openURL(url);
      } else if (platform === 'twitter') {
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
        await Linking.openURL(url);
      } else if (platform === 'instagram') {
        Alert.alert(
          'Compartir en Instagram',
          'El link fue copiado. Abre Instagram y pégalo en tu historia o publicación.',
        );
      } else {
        await Share.share({
          message,
          url: result.share_url,
          title: `${petName} - ${statusText}`,
        });
      }
    } catch (error: unknown) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, i18next.t));
    } finally {
      setIsLoading(false);
    }
  };

  const handleNativeShare = async () => {
    setIsLoading(true);
    try {
      const result = await generateLink.mutateAsync({ petID: petId });
      const petForMessage = pet ?? { name: petName, type: petType, status: status === 'found' ? 'found' as const : 'lost' as const };
      const message = buildWhatsAppMessage(petForMessage, result.share_url);

      await Share.share({
        message,
        url: result.share_url,
        title: `${petName} - ${statusText}`,
      });
    } catch (error: unknown) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, i18next.t));
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleQR = async () => {
    if (showQR) {
      setShowQR(false);
      return;
    }
    if (shareUrl) {
      setShowQR(true);
      return;
    }
    try {
      const link = await generateLink.mutateAsync({ petID: petId, data: {} });
      setShareUrl(link.share_url);
      setExpiresAt(link.expires_at);
      setShowQR(true);
    } catch (err: unknown) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
    }
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={styles.loadingText}>Generando link...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Compartir mascota</Text>
      <Text style={styles.subtitle}>
        Ayuda a difundir. Compartir aumenta las chances de encontrarla.
      </Text>

      <View style={styles.platformsRow}>
        {PLATFORMS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.platformButton, { backgroundColor: p.color }]}
            onPress={() => handleShare(p.key)}
          >
            <Text style={styles.platformLabel}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.qrToggle} onPress={handleToggleQR} disabled={generateLink.isPending}>
        <Text style={styles.qrToggleText}>{showQR ? 'Ocultar QR' : 'Ver código QR'}</Text>
      </TouchableOpacity>

      {showQR && (
        <View style={styles.qrCard}>
          {generateLink.isPending ? (
            <ActivityIndicator size="large" color={COLORS.primary} />
          ) : shareUrl ? (
            <>
              <QRCode value={shareUrl} size={200} color={COLORS.textPrimary} backgroundColor={COLORS.white} />
              <Text style={styles.qrLabel}>{petName}</Text>
              {(() => {
                const expiry = getExpiryInfo(expiresAt);
                if (!expiry.hasExpiry) return null;
                if (expiry.isExpired) {
                  return (
                    <Text style={styles.expiryExpired}>Link expirado — genera uno nuevo</Text>
                  );
                }
                return (
                  <Text style={expiry.isWarning ? styles.expiryWarning : styles.expiryOk}>
                    {expiry.label}
                  </Text>
                );
              })()}
            </>
          ) : null}
        </View>
      )}

      <TouchableOpacity style={styles.moreButton} onPress={handleNativeShare}>
        <Text style={styles.moreText}>Más opciones...</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: SPACING.md,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    marginVertical: SPACING.sm,
  },
  title: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  loadingText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
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
    color: COLORS.white,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  moreButton: {
    marginTop: SPACING.md,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  moreText: {
    color: COLORS.primary,
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
    color: COLORS.primary,
    fontWeight: '600',
  },
  qrCard: {
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  qrLabel: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  expiryOk: {
    marginTop: SPACING.xs,
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
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
    color: '#ef4444',
    fontWeight: '600',
  },
});
