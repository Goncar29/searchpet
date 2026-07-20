// ============================================================
// SearchPet - Foster Home Detail Screen
// ============================================================

import {
  View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Dimensions,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useFosterHomeByID, useSubmitAbuseReport } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { FosterHomePhoto, AnimalKind } from '@shared/types';
import { useAuthStore } from '../../store';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

const { width } = Dimensions.get('window');

export default function FosterHomeDetailScreen() {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: fosterHome, isLoading, isError } = useFosterHomeByID(id);
  const { user } = useAuthStore();

  const submitAbuseReport = useSubmitAbuseReport();

  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportReason, setReportReason] = useState('');

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (isError || !fosterHome) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48 }}>🏠</Text>
        <Text style={styles.notFoundText}>{t('common:noResults')}</Text>
      </View>
    );
  }

  const isOwner = user?.id === fosterHome.owner_user_id;
  const photos = fosterHome.photos ?? [];

  const contactViaChat = () => {
    router.push(`/chat/${fosterHome.owner_user_id}` as `/${string}`);
  };

  const contactViaWhatsapp = () => {
    if (!fosterHome.whatsapp_phone) return;
    const digits = fosterHome.whatsapp_phone.replace(/[^0-9]/g, '');
    Linking.openURL(`https://wa.me/${digits}`);
  };

  const openReportModal = () => {
    setReportReason('');
    setReportModalVisible(true);
  };

  const submitReport = () => {
    const reason = reportReason.trim();
    if (!reason) return;

    submitAbuseReport.mutate(
      { target_foster_home_id: id, reason },
      {
        onSuccess: () => {
          setReportModalVisible(false);
          Alert.alert(i18next.t('common:confirm'), i18next.t('fosterHomes:report.success'));
        },
        onError: (err: unknown) => {
          Alert.alert(i18next.t('common:error'), getErrorMessage(err, i18next.t));
        },
      },
    );
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Photo gallery */}
      <View style={styles.carouselContainer}>
        {photos.length > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
          >
            {photos.map((photo: FosterHomePhoto) => (
              <Image key={photo.id} source={{ uri: photo.url }} style={styles.carouselImage} />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={{ fontSize: 60 }}>🏠</Text>
          </View>
        )}
      </View>

      <View style={styles.content}>
        {/* City */}
        <Text style={styles.cityText}>📍 {fosterHome.city}</Text>

        {/* Details */}
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>
              {t('fosterHomes:register.housingType')}
            </Text>
            <Text style={styles.detailValue}>
              {t(`fosterHomes:housingType.${fosterHome.housing_type}`)}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('fosterHomes:directory.capacity')}</Text>
            <Text style={styles.detailValue}>{fosterHome.capacity}</Text>
          </View>
        </View>

        {/* Animal type chips */}
        <View style={styles.chipRow}>
          {fosterHome.animal_types.map((animalType: AnimalKind) => (
            <View key={animalType} style={styles.chip}>
              <Text style={styles.chipText}>
                {t(`fosterHomes:animalType.${animalType}`)}
              </Text>
            </View>
          ))}
        </View>

        {/* Description */}
        {fosterHome.description ? (
          <View style={styles.descriptionCard}>
            <Text style={styles.sectionTitle}>{t('fosterHomes:register.description')}</Text>
            <Text style={styles.descriptionText}>{fosterHome.description}</Text>
          </View>
        ) : null}

        {/* Contact section */}
        {!isOwner && (
          <View style={styles.contactCard}>
            <TouchableOpacity style={styles.contactChatButton} onPress={contactViaChat}>
              <Text style={styles.contactChatButtonText}>
                {t('fosterHomes:detail.contactChat')}
              </Text>
            </TouchableOpacity>

            {fosterHome.whatsapp_phone ? (
              <TouchableOpacity style={styles.contactWhatsappButton} onPress={contactViaWhatsapp}>
                <Text style={styles.contactWhatsappButtonText}>
                  {t('fosterHomes:detail.contactWhatsapp')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Report */}
        {!isOwner && (
          <TouchableOpacity style={styles.reportButton} onPress={openReportModal}>
            <Text style={styles.reportButtonText}>{t('fosterHomes:detail.reportCta')}</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 80 }} />
      </View>

      {/* Report modal */}
      <Modal
        visible={reportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{t('fosterHomes:report.title')}</Text>
            <Text style={styles.modalLabel}>{t('fosterHomes:report.reasonLabel')}</Text>
            <TextInput
              style={styles.modalInput}
              value={reportReason}
              onChangeText={setReportReason}
              placeholder={t('fosterHomes:report.reasonPlaceholder')}
              placeholderTextColor={COLORS.placeholder}
              multiline
              numberOfLines={4}
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setReportModalVisible(false)}
              >
                <Text style={styles.modalCancelButtonText}>{t('common:cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalSubmitButton,
                  (!reportReason.trim() || submitAbuseReport.isPending) && styles.disabledButton,
                ]}
                onPress={submitReport}
                disabled={!reportReason.trim() || submitAbuseReport.isPending}
              >
                {submitAbuseReport.isPending ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text style={styles.modalSubmitButtonText}>
                    {t('fosterHomes:report.submit')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  notFoundText: {
    fontSize: FONTS.sizes.lg,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  carouselContainer: { width, height: 260, position: 'relative' },
  carouselImage: { width, height: 260, resizeMode: 'cover' },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { padding: SPACING.lg },
  cityText: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  detailsCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailLabel: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, fontWeight: '500' },
  detailValue: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, fontWeight: '600' },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
  },
  chip: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    ...SHADOWS.sm,
  },
  chipText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  descriptionCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  descriptionText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, lineHeight: 22 },
  contactCard: {
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  contactChatButton: {
    backgroundColor: COLORS.secondary,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  contactChatButtonText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },
  contactWhatsappButton: {
    backgroundColor: COLORS.whatsapp,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  contactWhatsappButtonText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },
  reportButton: {
    borderWidth: 1,
    borderColor: COLORS.danger,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  reportButtonText: { color: COLORS.danger, fontSize: FONTS.sizes.sm, fontWeight: '700' },
  disabledButton: { opacity: 0.6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    ...SHADOWS.lg,
  },
  modalLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  modalInput: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: SPACING.md,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  modalButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  modalCancelButton: {
    backgroundColor: COLORS.background,
  },
  modalCancelButtonText: {
    color: COLORS.textPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  modalSubmitButton: {
    backgroundColor: COLORS.danger,
  },
  modalSubmitButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
  },
});
