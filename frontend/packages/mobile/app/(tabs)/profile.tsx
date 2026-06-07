// ============================================================
// SearchPet - Profile Screen
// ============================================================

import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Image, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useLanguageStore } from '../../store';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { useMyPets, usePublicProfile, useUploadProfilePhotoNative, useVerificationStatus, useSendEmailOTP, useConfirmEmailOTP, useSendSmsOTP, useConfirmSmsOTP } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import { LANG_KEY } from '../../i18n';

export default function ProfileScreen() {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const { data: myPets } = useMyPets();
  const { data: myProfile } = usePublicProfile(user?.id ?? '');
  const uploadProfilePhoto = useUploadProfilePhotoNative();

  // Verification state
  const { data: verificationStatus, error: verificationError } = useVerificationStatus();
  const sendEmailOTP = useSendEmailOTP();
  const confirmEmailOTP = useConfirmEmailOTP();
  const sendSmsOTP = useSendSmsOTP();
  const confirmSmsOTP = useConfirmSmsOTP();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetStep, setSheetStep] = useState<'send' | 'confirm'>('send');
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);

  // SMS OTP state
  const [smsSheetVisible, setSmsSheetVisible] = useState(false);
  const [smsSheetStep, setSmsSheetStep] = useState<'send' | 'confirm'>('send');
  const [smsOtpCode, setSmsOtpCode] = useState('');
  const [smsOtpError, setSmsOtpError] = useState('');
  const [smsResendCountdown, setSmsResendCountdown] = useState(0);
  const [smsUnavailable, setSmsUnavailable] = useState(false);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  useEffect(() => {
    if (smsResendCountdown <= 0) return;
    const timer = setTimeout(() => setSmsResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [smsResendCountdown]);

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
      setSheetStep('confirm');
      setResendCountdown(60);
    } catch (err) {
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

  const handleOpenSmsSheet = () => {
    setSmsSheetStep('send');
    setSmsOtpCode('');
    setSmsOtpError('');
    setSmsUnavailable(false);
    setSmsSheetVisible(true);
  };

  const handleSendSmsOTP = async () => {
    const phoneNumber = user?.phone?.trim() ?? '';
    try {
      await sendSmsOTP.mutateAsync(phoneNumber);
      setSmsSheetStep('confirm');
      setSmsResendCountdown(60);
    } catch (err: any) {
      if (err.status === 501) {
        setSmsUnavailable(true);
      } else {
        Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
      }
    }
  };

  const handleConfirmSmsOTP = async () => {
    if (smsOtpCode.length !== 6) {
      setSmsOtpError(i18next.t('profile:otpError'));
      return;
    }
    setSmsOtpError('');
    try {
      await confirmSmsOTP.mutateAsync({ phone: user?.phone?.trim() ?? '', code: smsOtpCode });
      setSmsSheetVisible(false);
    } catch (err) {
      setSmsOtpError(getErrorMessage(err, (key) => i18next.t(key)));
    }
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>👤</Text>
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

  const handleLogout = () => {
    Alert.alert(i18next.t('profile:logoutConfirmTitle'), i18next.t('profile:logoutConfirmMsg'), [
      { text: i18next.t('common:cancel'), style: 'cancel' },
      { text: i18next.t('profile:logoutYes'), style: 'destructive', onPress: () => logout() },
    ]);
  };

  const handleLanguageSwitch = () => {
    Alert.alert(i18next.t('profile:languageTitle'), '', [
      {
        text: i18next.t('profile:spanish'),
        onPress: () => {
          i18next.changeLanguage('es');
          AsyncStorage.setItem(LANG_KEY, 'es');
          setLanguage('es');
        },
      },
      {
        text: i18next.t('profile:english'),
        onPress: () => {
          i18next.changeLanguage('en');
          AsyncStorage.setItem(LANG_KEY, 'en');
          setLanguage('en');
        },
      },
      {
        text: i18next.t('profile:portuguese'),
        onPress: () => {
          i18next.changeLanguage('pt');
          AsyncStorage.setItem(LANG_KEY, 'pt');
          setLanguage('pt');
        },
      },
      { text: i18next.t('common:cancel'), style: 'cancel' },
    ]);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* User Card */}
      <View style={styles.userCard}>
        <TouchableOpacity onPress={pickAndUploadAvatar} style={styles.avatarContainer}>
          {uploadProfilePhoto.isPending ? (
            <View style={styles.avatar}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : user?.profile_photo_url ? (
            <Image source={{ uri: user.profile_photo_url }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={{ fontSize: 36 }}>👤</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={pickAndUploadAvatar} style={styles.changePhotoButton}>
          <Text style={styles.changePhotoText}>{t('changePhoto')}</Text>
        </TouchableOpacity>
        <Text style={styles.userName}>{user?.name}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
        {user?.city ? (
          <Text style={styles.userCity}>📍 {user.city}</Text>
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

      {/* SMS Verification Row — only if phone not verified */}
      {!verificationDisabled && verificationStatus?.phone_verified === false && (
        <View style={styles.verificationSection}>
          <Text style={styles.verificationLabel}>{t('phoneVerification')}</Text>
          {smsUnavailable ? (
            <View style={[styles.verifiedBadgeRow, { backgroundColor: COLORS.textMuted }]}>
              <Text style={styles.verifiedBadgeText}>{t('smsUnavailable')}</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.verifyButton} onPress={handleOpenSmsSheet}>
              <Text style={styles.verifyButtonText}>{t('verifyPhone')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* SMS Verification Bottom Sheet */}
      <Modal
        visible={smsSheetVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSmsSheetVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.sheetContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            {smsSheetStep === 'send' ? t('verifySmsTitle') : t('verifySmsCode')}
          </Text>
          <Text style={styles.sheetSubtitle}>
            {smsUnavailable
              ? t('smsUnavailableText')
              : smsSheetStep === 'send'
              ? t('sendSmsTo', { phone: user?.phone || '' })
              : t('checkSmsCode')}
          </Text>

          {smsUnavailable ? (
            <TouchableOpacity style={styles.sheetCancelButton} onPress={() => setSmsSheetVisible(false)}>
              <Text style={styles.sheetCancelText}>{t('close')}</Text>
            </TouchableOpacity>
          ) : smsSheetStep === 'send' ? (
            <TouchableOpacity
              style={[styles.sheetPrimaryButton, (sendSmsOTP.isPending || !user?.phone) && styles.buttonDisabled]}
              onPress={handleSendSmsOTP}
              disabled={sendSmsOTP.isPending || !user?.phone}
            >
              {sendSmsOTP.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.sheetPrimaryButtonText}>{t('sendSmsCode')}</Text>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <TextInput
                style={styles.otpInput}
                value={smsOtpCode}
                onChangeText={(t) => { setSmsOtpCode(t.replace(/\D/g, '').slice(0, 6)); setSmsOtpError(''); }}
                placeholder="000000"
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
              {smsOtpError ? <Text style={styles.otpError}>{smsOtpError}</Text> : null}
              <TouchableOpacity
                style={[styles.sheetPrimaryButton, confirmSmsOTP.isPending && styles.buttonDisabled]}
                onPress={handleConfirmSmsOTP}
                disabled={confirmSmsOTP.isPending}
              >
                {confirmSmsOTP.isPending ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.sheetPrimaryButtonText}>{t('confirm')}</Text>
                )}
              </TouchableOpacity>
              {smsResendCountdown > 0 ? (
                <Text style={styles.resendCountdown}>{t('resendIn', { seconds: smsResendCountdown })}</Text>
              ) : (
                <TouchableOpacity onPress={handleSendSmsOTP} disabled={sendSmsOTP.isPending}>
                  <Text style={styles.resendLink}>{t('resend')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          <TouchableOpacity style={styles.sheetCancelButton} onPress={() => setSmsSheetVisible(false)}>
            <Text style={styles.sheetCancelText}>{t('common:cancel')}</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

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
              style={[styles.sheetPrimaryButton, sendEmailOTP.isPending && styles.buttonDisabled]}
              onPress={handleSendOTP}
              disabled={sendEmailOTP.isPending}
            >
              {sendEmailOTP.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.sheetPrimaryButtonText}>{t('sendCode')}</Text>
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
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.sheetPrimaryButtonText}>{t('confirm')}</Text>
                )}
              </TouchableOpacity>
              {resendCountdown > 0 ? (
                <Text style={styles.resendCountdown}>{t('resendIn', { seconds: resendCountdown })}</Text>
              ) : (
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
          <Text style={styles.menuIcon}>✏️</Text>
          <Text style={styles.menuText}>{t('editProfile.title')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/my-pets')}
        >
          <Text style={styles.menuIcon}>🐾</Text>
          <Text style={styles.menuText}>{t('menuMyPets')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>


        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/badges')}
        >
          <Text style={styles.menuIcon}>🏆</Text>
          <Text style={styles.menuText}>{t('menuBadges')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/leaderboard')}
        >
          <Text style={styles.menuIcon}>🥇</Text>
          <Text style={styles.menuText}>{t('menuLeaderboard')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/alerts')}
        >
          <Text style={styles.menuIcon}>🔔</Text>
          <Text style={styles.menuText}>{t('menuAlerts')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/groups' as any)}
        >
          <Text style={styles.menuIcon}>👥</Text>
          <Text style={styles.menuText}>{t('menuGroups')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/shelters' as any)}
        >
          <Text style={styles.menuIcon}>🏠</Text>
          <Text style={styles.menuText}>{t('menuShelters')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/blocked-users' as any)}
        >
          <Text style={styles.menuIcon}>🚫</Text>
          <Text style={styles.menuText}>{t('menuBlockedUsers')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => Alert.alert(i18next.t('profile:comingSoon'), i18next.t('profile:settingsComingSoon'))}
        >
          <Text style={styles.menuIcon}>⚙️</Text>
          <Text style={styles.menuText}>{t('menuSettings')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={handleLanguageSwitch}
        >
          <Text style={styles.menuIcon}>🌐</Text>
          <Text style={styles.menuText}>{t('menuLanguage')}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>{t('logout')}</Text>
      </TouchableOpacity>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  linkText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  userCard: {
    alignItems: 'center',
    padding: SPACING.xl,
    backgroundColor: COLORS.white,
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
    backgroundColor: COLORS.background,
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
    color: COLORS.primary,
    fontWeight: '600',
  },
  userName: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  userEmail: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  userCity: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  verifiedBadge: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    marginTop: SPACING.sm,
  },
  verifiedText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
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
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  menuSection: {
    backgroundColor: COLORS.white,
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
    borderBottomColor: COLORS.border,
  },
  menuIcon: { fontSize: 22, marginRight: SPACING.md },
  menuText: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  menuArrow: {
    fontSize: FONTS.sizes.xl,
    color: COLORS.textMuted,
  },
  logoutButton: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.danger,
    alignItems: 'center',
  },
  logoutText: {
    color: COLORS.danger,
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
  },
  verificationSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  verificationLabel: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  verifiedBadgeRow: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  verifiedBadgeText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  verifyButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
  },
  verifyButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  sheetContainer: {
    flex: 1,
    backgroundColor: COLORS.white,
    padding: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: SPACING.lg,
  },
  sheetTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  sheetSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xl,
  },
  otpInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    marginBottom: SPACING.md,
    color: COLORS.textPrimary,
  },
  otpError: {
    color: COLORS.danger,
    fontSize: FONTS.sizes.sm,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  sheetPrimaryButton: {
    backgroundColor: COLORS.primary,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sheetPrimaryButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  resendCountdown: {
    textAlign: 'center',
    color: COLORS.textMuted,
    fontSize: FONTS.sizes.sm,
    marginBottom: SPACING.sm,
  },
  resendLink: {
    textAlign: 'center',
    color: COLORS.primary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  sheetCancelButton: {
    marginTop: SPACING.sm,
    alignItems: 'center',
  },
  sheetCancelText: {
    color: COLORS.textMuted,
    fontSize: FONTS.sizes.sm,
  },
});
