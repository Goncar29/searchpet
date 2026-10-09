// ============================================================
// SearchPet - Profile Screen
// ============================================================

import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Image, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useLanguageStore } from '../../store';
import { useThemeStore } from '../../store/theme';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ApiError } from '../../../shared/api/client';
import { useMyPets, usePublicProfile, useUploadProfilePhotoNative, useVerificationStatus, useSendEmailOTP, useConfirmEmailOTP } from '../../../shared/hooks';
import { SPACING, FONTS, RADIUS, SHADOWS, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { LANG_KEY } from '../../i18n';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';
import { IMAGE_SIZES } from '../../constants/imageSizes';
import { Icon } from '../../components/Icon';
import { IconLabel } from '../../components/IconLabel';
import { OptionPickerModal } from '../../components/OptionPickerModal';
import { ActionMenuModal } from '../../components/ActionMenuModal';

export default function ProfileScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('profile');
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const setThemePreference = useThemeStore((state) => state.setPreference);
  const { data: myPets } = useMyPets();
  const { data: myProfile } = usePublicProfile(user?.id ?? '');
  const uploadProfilePhoto = useUploadProfilePhotoNative();

  // Verification state
  const { data: verificationStatus, error: verificationError } = useVerificationStatus();
  const sendEmailOTP = useSendEmailOTP();
  const confirmEmailOTP = useConfirmEmailOTP();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetStep, setSheetStep] = useState<'send' | 'confirm'>('send');
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);
  // Which choice picker is open (Settings → theme, Language → language).
  const [picker, setPicker] = useState<'theme' | 'language' | 'logout' | null>(null);
  const themePreference = useThemeStore((state) => state.preference);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  // 501 → feature disabled: verificationError will have status 501
  const verificationDisabled = (verificationError as any)?.status === 501;

  const pickAndUploadAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(i18next.t('profile:permissionRequired'), i18next.t('profile:galleryPermission'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      try {
        await uploadProfilePhoto.mutateAsync(result.assets[0].uri);
      } catch (err) {
        Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
      }
    }
  };

  const handleOpenSheet = () => {
    setSheetStep('send');
    setOtpCode('');
    setOtpError('');
    setSheetVisible(true);
  };

  const handleSendOTP = async () => {
    try {
      await sendEmailOTP.mutateAsync();
      // Vaciar lo tipeado: el backend retira los códigos anteriores al acuñar uno
      // nuevo, así que los dígitos que quedaron en la caja pertenecen a un código
      // que ya no puede matchear. Enviarlos quema uno de los 5 intentos y devuelve
      // "inválido" sin ninguna explicación. Sólo en el camino de ÉXITO: si el
      // pedido se rechazó, no se acuñó nada y lo tipeado puede seguir sirviendo.
      setOtpCode('');
      setOtpError('');
      setSheetStep('confirm');
      setResendCountdown(60);
    } catch (err) {
      // El cooldown es el único límite cuya espera se mide en segundos, así que
      // es el único que alimenta el contador. El tope diario se cuenta en horas
      // y su mensaje ya dice "mañana"; la reserva del canal no trae número
      // porque depende del tráfico de terceros.
      //
      // Se pasa al paso de confirmación: un cooldown significa que ya se emitió
      // un código y probablemente esté en la casilla del usuario.
      if (err instanceof ApiError && err.retryAfter) {
        // El cooldown significa que YA se emitió un código y probablemente esté
        // en la casilla, por eso pasa al paso de confirmación.
        //
        // El rate limit de ruta NO acuñó nada: murió en el middleware, antes de
        // llegar al servicio. Arranca el contador —que apaga el botón— pero deja
        // al usuario donde estaba.
        if (err.code === 'otp_cooldown') {
          setSheetStep('confirm');
          setResendCountdown(err.retryAfter);
        } else if (err.code === 'rate_limit_exceeded') {
          setResendCountdown(err.retryAfter);
        }
      }
      Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
    }
  };

  const handleConfirmOTP = async () => {
    if (otpCode.length !== 6) {
      setOtpError(i18next.t('profile:otpError'));
      return;
    }
    setOtpError('');
    try {
      await confirmEmailOTP.mutateAsync(otpCode);
      setSheetVisible(false);
    } catch (err) {
      setOtpError(getErrorMessage(err, (key) => i18next.t(key)));
    }
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <View style={{ marginBottom: SPACING.md }}><Icon name="person" size={48} color={colors.textMuted} /></View>
        <Text style={styles.title}>{t('title')}</Text>
        <Text style={styles.subtitle}>{t('subtitle')}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.primaryButtonText}>{t('loginButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/register')}>
          <Text style={styles.linkText}>{t('createAccount')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ marginTop: SPACING.md }}
          onPress={() => router.push('/shelters' as any)}
        >
          <Text style={styles.linkText}>{t('sheltersButton')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Settings opens the theme choice and the Language row the language choice,
  // both in OptionPickerModal: Alert.alert on Android shows at most three
  // buttons (Cancel was dropped) and cannot be dismissed by tapping outside.
  // System follows the phone; Light and Dark override it until the user goes
  // back to System.

  // A failed save still changes the language for this session; it just will
  // not survive a restart.
  const chooseLanguage = (lang: 'es' | 'en' | 'pt') => {
    i18next.changeLanguage(lang);
    AsyncStorage.setItem(LANG_KEY, lang).catch((err) => {
      console.warn('[profile] could not save the language', err);
    });
    setLanguage(lang);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* User Card */}
      <View style={styles.userCard}>
        <TouchableOpacity onPress={pickAndUploadAvatar} style={styles.avatarContainer}>
          {uploadProfilePhoto.isPending ? (
            <View style={styles.avatar}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : user?.profile_photo_url ? (
            <Image source={{ uri: cloudinaryThumb(user.profile_photo_url, IMAGE_SIZES.avatarMd) }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Icon name="person" size={36} color={colors.textMuted} />
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={pickAndUploadAvatar} style={styles.changePhotoButton}>
          <Text style={styles.changePhotoText}>{t('changePhoto')}</Text>
        </TouchableOpacity>
        <Text style={styles.userName}>{user?.name}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
        {user?.city ? (
          <IconLabel icon="location-on" color={colors.textSecondary} size={14} style={{ marginTop: 2 }}>
            <Text style={[styles.userCity, { marginTop: 0 }]}>{user.city}</Text>
          </IconLabel>
        ) : null}
        {user?.is_verified && (
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedText}>{t('verified')}</Text>
          </View>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{myPets?.length || 0}</Text>
          <Text style={styles.statLabel}>{t('myPets')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{myProfile?.found_count ?? 0}</Text>
          <Text style={styles.statLabel}>{t('found')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{myProfile?.total_reports ?? 0}</Text>
          <Text style={styles.statLabel}>{t('reports')}</Text>
        </View>
      </View>

      {/* Verification Row — hidden if feature disabled (501) */}
      {!verificationDisabled && (
        <View style={styles.verificationSection}>
          <Text style={styles.verificationLabel}>{t('accountVerification')}</Text>
          {verificationStatus?.is_verified ? (
            <View style={styles.verifiedBadgeRow}>
              <Text style={styles.verifiedBadgeText}>{t('verified')}</Text>
            </View>
          ) : verificationStatus !== undefined ? (
            <TouchableOpacity style={styles.verifyButton} onPress={handleOpenSheet}>
              <Text style={styles.verifyButtonText}>{t('verifyEmail')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* Email Verification Bottom Sheet */}
      <Modal
        visible={sheetVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSheetVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.sheetContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            {sheetStep === 'send' ? t('verifyEmailTitle') : t('verifyEmailCode')}
          </Text>
          <Text style={styles.sheetSubtitle}>
            {sheetStep === 'send'
              ? t('sendCodeTo', { email: user?.email })
              : t('checkEmailCode')}
          </Text>

          {sheetStep === 'send' ? (
            <TouchableOpacity
              style={[styles.sheetPrimaryButton, (sendEmailOTP.isPending || resendCountdown > 0) && styles.buttonDisabled]}
              onPress={handleSendOTP}
              disabled={sendEmailOTP.isPending || resendCountdown > 0}
            >
              {sendEmailOTP.isPending ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.sheetPrimaryButtonText}>
                  {resendCountdown > 0 ? t('resendIn', { seconds: resendCountdown }) : t('sendCode')}
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <TextInput
                style={styles.otpInput}
                value={otpCode}
                onChangeText={(v) => { setOtpCode(v.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                placeholder="000000"
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
              {otpError ? <Text style={styles.otpError}>{otpError}</Text> : null}
              <TouchableOpacity
                style={[styles.sheetPrimaryButton, confirmEmailOTP.isPending && styles.buttonDisabled]}
                onPress={handleConfirmOTP}
                disabled={confirmEmailOTP.isPending}
              >
                {confirmEmailOTP.isPending ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.sheetPrimaryButtonText}>{t('confirm')}</Text>
                )}
              </TouchableOpacity>
              {resendCountdown > 0 ? (
                <Text style={styles.resendCountdown}>{t('resendIn', { seconds: resendCountdown })}</Text>
              ) : (
                // Sin `resendCountdown > 0`: este link vive en la rama FALSA de
                // `resendCountdown > 0 ? … : …`, asi que ahi la condicion no
                // puede ser verdadera.
                <TouchableOpacity onPress={handleSendOTP} disabled={sendEmailOTP.isPending}>
                  <Text style={styles.resendLink}>{t('resend')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          <TouchableOpacity style={styles.sheetCancelButton} onPress={() => setSheetVisible(false)}>
            <Text style={styles.sheetCancelText}>{t('common:cancel')}</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Menu Items */}
      <View style={styles.menuSection}>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/edit-profile')}
        >
          <View style={styles.menuIcon}><Icon name="edit" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('editProfile.title')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/my-pets')}
        >
          <View style={styles.menuIcon}><Icon name="pets" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuMyPets')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/adopt' as any)}
        >
          <View style={styles.menuIcon}><Icon name="home" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('adoption:section.title')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/badges')}
        >
          <View style={styles.menuIcon}><Icon name="emoji-events" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuBadges')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/leaderboard')}
        >
          <View style={styles.menuIcon}><Icon name="workspace-premium" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuLeaderboard')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/alerts')}
        >
          <View style={styles.menuIcon}><Icon name="notifications" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuAlerts')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/groups' as any)}
        >
          <View style={styles.menuIcon}><Icon name="group" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuGroups')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/shelters' as any)}
        >
          <View style={styles.menuIcon}><Icon name="home-work" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuShelters')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/foster-homes' as any)}
        >
          <View style={styles.menuIcon}><Icon name="location-city" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('fosterHomes:nav')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/blocked-users' as any)}
        >
          <View style={styles.menuIcon}><Icon name="block" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuBlockedUsers')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => setPicker('theme')}
        >
          <View style={styles.menuIcon}><Icon name="settings" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuSettings')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => setPicker('language')}
        >
          <View style={styles.menuIcon}><Icon name="language" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuLanguage')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => Linking.openURL('https://github.com/Goncar29/searchpet')}
        >
          <View style={styles.menuIcon}><Icon name="link" size={22} color={colors.textSecondary} /></View>
          <Text style={styles.menuText}>{t('menuGitHub')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={() => setPicker('logout')}>
        <Text style={styles.logoutText}>{t('logout')}</Text>
      </TouchableOpacity>

      <View style={{ height: 100 }} />

      <OptionPickerModal
        visible={picker === 'theme'}
        title={t('themeTitle')}
        options={[
          { value: 'system', label: t('themeSystem') },
          { value: 'light', label: t('themeLight') },
          { value: 'dark', label: t('themeDark') },
        ]}
        selected={themePreference}
        onSelect={(value) => { setThemePreference(value); }}
        onClose={() => setPicker(null)}
        closeLabel={t('common:close')}
      />
      <OptionPickerModal
        visible={picker === 'language'}
        title={t('languageTitle')}
        options={[
          { value: 'es', label: t('spanish') },
          { value: 'en', label: t('english') },
          { value: 'pt', label: t('portuguese') },
        ]}
        // Base code: 'en-US' marks English.
        selected={(i18next.language ?? '').slice(0, 2) as 'es' | 'en' | 'pt'}
        onSelect={chooseLanguage}
        onClose={() => setPicker(null)}
        closeLabel={t('common:close')}
      />
      {/* Same card as the pickers, not Alert.alert: closing it (X, outside,
          back button) is the Cancel. */}
      <ActionMenuModal
        visible={picker === 'logout'}
        title={i18next.t('profile:logoutConfirmTitle')}
        message={i18next.t('profile:logoutConfirmMsg')}
        actions={[
          { key: 'logout', label: i18next.t('profile:logoutYes'), onPress: () => logout(), destructive: true },
        ]}
        onClose={() => setPicker(null)}
        closeLabel={t('common:close')}
      />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: c.textPrimary,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  primaryButton: {
    backgroundColor: c.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
  },
  primaryButtonText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  linkText: {
    color: c.primary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  userCard: {
    alignItems: 'center',
    padding: SPACING.xl,
    backgroundColor: c.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    borderRadius: RADIUS.lg,
    ...SHADOWS.md,
  },
  avatarContainer: {
    marginBottom: SPACING.xs,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: c.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  changePhotoButton: {
    marginBottom: SPACING.md,
    marginTop: 4,
  },
  changePhotoText: {
    fontSize: FONTS.sizes.xs,
    color: c.primary,
    fontWeight: '600',
  },
  userName: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: c.textPrimary,
  },
  userEmail: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    marginTop: 4,
  },
  userCity: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    marginTop: 2,
  },
  verifiedBadge: {
    backgroundColor: c.success,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    marginTop: SPACING.sm,
  },
  verifiedText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: c.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNumber: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '700',
    color: c.primary,
  },
  statLabel: {
    fontSize: FONTS.sizes.xs,
    color: c.textSecondary,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: c.border,
    marginVertical: 4,
  },
  menuSection: {
    backgroundColor: c.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    ...SHADOWS.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  menuIcon: { marginRight: SPACING.md },
  menuText: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    color: c.textPrimary,
    fontWeight: '500',
  },
  menuArrow: {
    fontSize: FONTS.sizes.xl,
    color: c.textMuted,
  },
  logoutButton: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: c.danger,
    alignItems: 'center',
  },
  logoutText: {
    color: c.danger,
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
  },
  verificationSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  verificationLabel: {
    fontSize: FONTS.sizes.md,
    color: c.textPrimary,
    fontWeight: '500',
  },
  verifiedBadgeRow: {
    backgroundColor: c.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  verifiedBadgeText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  verifyButton: {
    backgroundColor: c.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
  },
  verifyButtonText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  sheetContainer: {
    flex: 1,
    backgroundColor: c.surface,
    padding: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: c.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: SPACING.lg,
  },
  sheetTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: c.textPrimary,
    marginBottom: SPACING.sm,
  },
  sheetSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
    marginBottom: SPACING.xl,
  },
  otpInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    marginBottom: SPACING.md,
    color: c.textPrimary,
  },
  otpError: {
    color: c.danger,
    fontSize: FONTS.sizes.sm,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  sheetPrimaryButton: {
    backgroundColor: c.primary,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sheetPrimaryButtonText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  resendCountdown: {
    textAlign: 'center',
    color: c.textMuted,
    fontSize: FONTS.sizes.sm,
    marginBottom: SPACING.sm,
  },
  resendLink: {
    textAlign: 'center',
    color: c.primary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  sheetCancelButton: {
    marginTop: SPACING.sm,
    alignItems: 'center',
  },
  sheetCancelText: {
    color: c.textMuted,
    fontSize: FONTS.sizes.sm,
  },
});
