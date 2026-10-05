// ============================================================
// SearchPet — AdoptionPetBody (mobile)
// The status-specific detail body for adoption listings, rendered by the pet
// detail screen for `adoption` / `adopted` pets. Isolated from the lost-pet body:
// no report timeline, no "mark found". Mirrors the web AdoptionPetBody.
// ============================================================

import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import type { Pet } from '@shared/types';
import { buildWhatsAppContactURL } from '@shared/utils/whatsappTemplates';
import { useAuthStore } from '../store';
import { ShareButton } from './ShareButton';
import { PdfFlyerButton } from './PdfFlyerButton';
import { type ThemeColors, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import { useTheme, useThemedStyles } from '../hooks/useTheme';
import { Icon } from './Icon';
import { IconLabel } from './IconLabel';

interface AdoptionPetBodyProps {
  pet: Pet;
}

export function AdoptionPetBody({ pet }: AdoptionPetBodyProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation(['pets', 'pet_detail', 'adoption', 'common']);
  const { user, isAuthenticated } = useAuthStore();
  const router = useRouter();

  // Resolved: the pet has a home. Celebratory record, no contact/share.
  if (pet.status === 'adopted') {
    return (
      <View testID="adopted-banner" style={styles.adoptedBanner}>
        <View style={styles.adoptedIcon}>
          <Icon name="celebration" size={48} color="#047857" />
        </View>
        <Text style={styles.adoptedTitle}>{t('adoption:detail.adoptedTitle', { name: pet.name })}</Text>
        <Text style={styles.adoptedSubtitle}>{t('adoption:detail.adoptedSubtitle')}</Text>
      </View>
    );
  }

  const isOwnerViewing = isAuthenticated && user?.id === pet.owner_id;

  return (
    <View>
      {pet.owner && (
        <View style={styles.ownerCard}>
          <Text style={styles.sectionTitle}>{t('pet_detail:ownerContact')}</Text>
          <View style={styles.ownerInfo}>
            <View style={styles.ownerAvatar}>
              <Icon name="person" size={28} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.ownerName}>{pet.owner.name}</Text>
            </View>
          </View>

          {pet.owner.phone && (
            <TouchableOpacity
              testID="whatsapp-contact"
              style={styles.contactButton}
              onPress={() => Linking.openURL(buildWhatsAppContactURL(pet.owner!.phone!, pet))}
            >
              <Text style={styles.contactButtonText}>{t('pet_detail:contact')}</Text>
            </TouchableOpacity>
          )}

          {/* In-app message — primary adoption contact channel for non-owner viewers. */}
          {!isOwnerViewing && (
            isAuthenticated ? (
              <TouchableOpacity
                testID="message-owner"
                style={styles.messageButton}
                onPress={() => router.push(`/chat/${pet.owner_id}?userName=${encodeURIComponent(pet.owner?.name ?? '')}` as `/${string}`)}
              >
                <IconLabel icon="chat-bubble" size={18} color={colors.onPrimary}>
                  <Text style={styles.messageButtonText}>{t('pets:detail.sendMessage')}</Text>
                </IconLabel>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                testID="login-gate"
                style={styles.loginButton}
                onPress={() => router.push('/login')}
              >
                <IconLabel icon="lock" size={18} color={colors.textSecondary}>
                  <Text style={styles.loginButtonText}>{t('pets:detail.loginToContact')}</Text>
                </IconLabel>
              </TouchableOpacity>
            )
          )}
        </View>
      )}

      {/* Sharing — spreads the adoption listing. Requires a session (the share-link
          endpoint is auth-gated), mirroring web. */}
      {isAuthenticated && (
        <View testID="share-block">
          <ShareButton petId={pet.id} petName={pet.name} petType={pet.type} status="adoption" pet={pet} />
          <PdfFlyerButton pet={pet} />
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  adoptedBanner: {
    backgroundColor: '#ecfdf5',
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  adoptedIcon: { marginBottom: SPACING.sm },
  adoptedTitle: { fontSize: FONTS.sizes.md, fontWeight: '800', color: '#065f46', textAlign: 'center' },
  adoptedSubtitle: { fontSize: FONTS.sizes.sm, color: '#047857', textAlign: 'center', marginTop: 4 },
  ownerCard: {
    backgroundColor: c.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  sectionTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: c.textPrimary, marginBottom: SPACING.sm },
  ownerInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  ownerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  ownerName: { fontSize: FONTS.sizes.md, fontWeight: '600', color: c.textPrimary },
  contactButton: {
    backgroundColor: c.whatsapp,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  contactButtonText: { color: c.onPrimary, fontSize: FONTS.sizes.md, fontWeight: '700' },
  messageButton: {
    backgroundColor: c.primary,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  messageButtonText: { color: c.onPrimary, fontSize: FONTS.sizes.md, fontWeight: '700' },
  loginButton: {
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  loginButtonText: { color: c.textSecondary, fontSize: FONTS.sizes.md, fontWeight: '600' },
});
