// ============================================================
// SearchPet - PetCard Component
// ============================================================

import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import type { Report } from '../../shared/types';

interface PetCardProps {
  report: Report;
  onPress: () => void;
}

export function PetCard({ report, onPress }: PetCardProps) {
  const pet = report.pet;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'lost': return COLORS.lost;
      case 'found': return COLORS.found;
      case 'sighting': return COLORS.sighting;
      default: return COLORS.primary;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'lost': return 'PERDIDO';
      case 'found': return 'ENCONTRADO';
      case 'sighting': return 'AVISTADO';
      default: return status.toUpperCase();
    }
  };

  const getTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `hace ${diffMins} min`;
    if (diffHours < 24) return `hace ${diffHours}h`;
    if (diffDays < 7) return `hace ${diffDays}d`;
    return date.toLocaleDateString('es');
  };

  const primaryPhoto = pet?.photos?.find(p => p.is_primary) || pet?.photos?.[0];

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      {/* Imagen */}
      <View style={styles.imageContainer}>
        {primaryPhoto ? (
          <Image source={{ uri: primaryPhoto.url }} style={styles.image} />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={{ fontSize: 40 }}>🐾</Text>
          </View>
        )}
        {/* Badge de status */}
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: getStatusColor(report.status) },
          ]}
        >
          <Text style={styles.statusText}>{getStatusLabel(report.status)}</Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.infoHeader}>
          <Text style={styles.petName} numberOfLines={1}>
            {pet?.name || 'Sin nombre'}
          </Text>
          <Text style={styles.timeAgo}>{getTimeAgo(report.created_at)}</Text>
        </View>

        <View style={styles.detailsRow}>
          {pet?.type && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{pet.type}</Text>
            </View>
          )}
          {pet?.breed && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{pet.breed}</Text>
            </View>
          )}
          {pet?.color && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{pet.color}</Text>
            </View>
          )}
        </View>

        {report.location_description && (
          <Text style={styles.location} numberOfLines={1}>
            📍 {report.location_description}
          </Text>
        )}

        {pet?.description && (
          <Text style={styles.description} numberOfLines={2}>
            {pet.description}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.md,
    overflow: 'hidden',
    ...SHADOWS.md,
  },
  imageContainer: {
    position: 'relative',
    height: 180,
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  statusText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  info: {
    padding: SPACING.md,
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  petName: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    flex: 1,
  },
  timeAgo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    marginLeft: SPACING.sm,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: SPACING.xs,
  },
  tag: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
  },
  tagText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  location: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  description: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
});
