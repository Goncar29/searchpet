// ============================================================
// SearchPet - HelperPickerModal (mobile)
// ============================================================

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useHelperCandidates } from '@shared/hooks';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';
import type { HelperCandidate } from '@shared/types';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import { IMAGE_SIZES } from '../constants/imageSizes';
import { Icon } from './Icon';

interface HelperPickerModalProps {
  petId: string;
  petName: string;
  /** True while the mutation that marks the pet as found is running. */
  loading?: boolean;
  /** Mutation error, already translated (`getErrorMessage`); drawn inside the modal. */
  error?: string | null;
  /**
   * `undefined` = there were no candidates, so NO `helper_ids` is sent (the
   * backend accepts that). `[]` = the owner answered "nobody helped". They are
   * two different answers and the backend treats them differently.
   */
  onConfirm: (helperIds: string[] | undefined) => void;
  onCancel: () => void;
}

function Avatar({ candidate }: { candidate: HelperCandidate }) {
  if (candidate.profile_photo_url) {
    return (
      <Image
        source={{ uri: cloudinaryThumb(candidate.profile_photo_url, IMAGE_SIZES.avatarSm) }}
        style={styles.avatar}
      />
    );
  }
  return (
    <View style={[styles.avatar, styles.avatarInitials]}>
      <Text style={styles.avatarText}>{candidate.name.trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
      {checked && <Icon name="check" size={16} color={COLORS.white} />}
    </View>
  );
}

/**
 * Asks who helped find the pet, BEFORE marking it found.
 *
 * Answering is mandatory when there are candidates (the backend enforces it with
 * 400 `helper_ids_required`; here Confirm stays disabled until the owner picks
 * someone or explicitly says "Nobody helped me"). There is no default
 * selection: a preselected answer is not an answer.
 *
 * Mount only while the confirmation is pending: the candidates query is born on
 * open and re-read every time. Mirrors `web/src/components/HelperPickerModal.tsx`.
 */
export function HelperPickerModal({
  petId,
  petName,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: HelperPickerModalProps) {
  const { t } = useTranslation(['pets', 'common']);
  const query = useHelperCandidates(petId, true);
  const { refetch } = query;

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [nobody, setNobody] = useState(false);

  // A 400 on confirm can mean the list changed since the modal opened (someone
  // reported in between): re-reading it is what lets the owner see that person
  // instead of hitting the same rejection again.
  useEffect(() => {
    if (error) void refetch();
  }, [error, refetch]);

  // `data == null` and NOT `items.length === 0` (rule #60): without data we do
  // not know whether there are candidates, and confirming blind is exactly what
  // must not happen.
  const candidates = query.data ?? null;
  const hasCandidates = candidates != null && candidates.length > 0;
  const answered = nobody || selected.size > 0;
  const confirmDisabled = loading || candidates == null || (hasCandidates && !answered);

  const toggleHelper = (id: string) => {
    setNobody(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleNobody = () => {
    setSelected(new Set());
    setNobody((prev) => !prev);
  };

  const handleConfirm = () => {
    if (confirmDisabled) return;
    if (!hasCandidates || candidates == null) {
      onConfirm(undefined);
      return;
    }
    // Filtered against the current list: if a re-read dropped someone, their id
    // does not travel.
    onConfirm(nobody ? [] : candidates.filter((c) => selected.has(c.id)).map((c) => c.id));
  };

  const title = hasCandidates
    ? t('pets:helpers.title', { name: petName })
    : t('pets:detail.markFound');
  // Without data we do not know that there are zero candidates, so the plain
  // "are you sure" copy is only for a list we actually read and found empty.
  const message = hasCandidates
    ? t('pets:helpers.message')
    : candidates != null
      ? t('pets:detail.markFoundConfirm', { name: petName })
      : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          {candidates == null && query.isError && (
            <View style={styles.stateBox} accessibilityLiveRegion="assertive">
              <Text style={styles.errorText}>{t('pets:helpers.loadError')}</Text>
              <TouchableOpacity
                style={styles.retry}
                onPress={() => void refetch()}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>{t('common:retry')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {candidates == null && !query.isError && (
            <View style={styles.stateBox}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={styles.stateText}>{t('common:loading')}</Text>
            </View>
          )}

          {hasCandidates && (
            <ScrollView style={styles.list}>
              {candidates.map((c) => {
                const checked = selected.has(c.id);
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.row}
                    onPress={() => toggleHelper(c.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={c.name}
                  >
                    <Checkbox checked={checked} />
                    <Avatar candidate={c} />
                    <Text style={styles.rowName} numberOfLines={1}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.row, styles.rowNobody]}
                onPress={toggleNobody}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: nobody }}
                accessibilityLabel={t('pets:helpers.nobody')}
              >
                <Checkbox checked={nobody} />
                <Text style={styles.rowNobodyText}>{t('pets:helpers.nobody')}</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {error ? (
            <Text style={styles.errorText} accessibilityLiveRegion="assertive">
              {error}
            </Text>
          ) : null}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton, loading && styles.disabled]}
              onPress={onCancel}
              disabled={loading}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>{t('common:cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.confirmButton, confirmDisabled && styles.disabled]}
              onPress={handleConfirm}
              disabled={confirmDisabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: confirmDisabled }}
            >
              {loading ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.confirmText}>{t('common:confirm')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    maxHeight: '85%',
    ...SHADOWS.lg,
  },
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  message: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  stateBox: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
  },
  stateText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  errorText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.danger,
    marginBottom: SPACING.sm,
  },
  retry: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.background,
  },
  retryText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  list: {
    flexGrow: 0,
    marginBottom: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  rowNobody: {
    borderStyle: 'dashed',
  },
  rowName: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  rowNobodyText: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarInitials: {
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  button: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: COLORS.background,
  },
  cancelText: {
    color: COLORS.textPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: COLORS.primary,
  },
  confirmText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
  },
  disabled: { opacity: 0.5 },
});
