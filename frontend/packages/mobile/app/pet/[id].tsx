// ============================================================
// SearchPet - Pet Detail Screen
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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePetByID, useReportsByPetID } from '../../shared/hooks';
import { ShareButton } from '../components/ShareButton';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';

const { width } = Dimensions.get('window');

export default function PetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: pet, isLoading } = usePetByID(id);
  const { data: reports } = useReportsByPetID(id);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!pet) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48 }}>🔍</Text>
        <Text style={styles.notFoundText}>Mascota no encontrada</Text>
      </View>
    );
  }

  const primaryPhoto = pet.photos?.find(p => p.is_primary) || pet.photos?.[0];
  const latestReport = reports?.[0];

  const contactOwner = () => {
    if (pet.owner?.phone) {
      const message = `Hola, vi tu mascota ${pet.name} en SearchPet.`;
      Linking.openURL(`https://wa.me/${pet.owner.phone}?text=${encodeURIComponent(message)}`);
    } else {
      router.push(`/chat/${pet.owner_id}`);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Foto principal */}
      <View style={styles.imageContainer}>
        {primaryPhoto ? (
          <Image source={{ uri: primaryPhoto.url }} style={styles.image} />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={{ fontSize: 60 }}>🐾</Text>
          </View>
        )}
      </View>

      <View style={styles.content}>
        {/* Nombre y status */}
        <View style={styles.headerRow}>
          <Text style={styles.petName}>{pet.name}</Text>
          <View style={[
            styles.statusBadge,
            { backgroundColor: pet.status === 'found' ? COLORS.found : COLORS.lost },
          ]}>
            <Text style={styles.statusText}>
              {pet.status === 'found' ? 'ENCONTRADO' : 'PERDIDO'}
            </Text>
          </View>
        </View>

        {/* Detalles */}
        <View style={styles.detailsCard}>
          {pet.type && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Tipo</Text>
              <Text style={styles.detailValue}>{pet.type}</Text>
            </View>
          )}
          {pet.breed && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Raza</Text>
              <Text style={styles.detailValue}>{pet.breed}</Text>
            </View>
          )}
          {pet.color && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Color</Text>
              <Text style={styles.detailValue}>{pet.color}</Text>
            </View>
          )}
          {latestReport?.location_description && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Última ubicación</Text>
              <Text style={styles.detailValue}>{latestReport.location_description}</Text>
            </View>
          )}
        </View>

        {/* Descripción */}
        {pet.description && (
          <View style={styles.descriptionCard}>
            <Text style={styles.sectionTitle}>Descripción</Text>
            <Text style={styles.descriptionText}>{pet.description}</Text>
          </View>
        )}

        {/* Dueño */}
        {pet.owner && (
          <View style={styles.ownerCard}>
            <Text style={styles.sectionTitle}>Contacto del dueño</Text>
            <View style={styles.ownerInfo}>
              <View style={styles.ownerAvatar}>
                <Text style={{ fontSize: 24 }}>👤</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ownerName}>{pet.owner.name}</Text>
                {pet.owner.is_verified && (
                  <Text style={styles.verifiedText}>Verificado</Text>
                )}
              </View>
            </View>
            <TouchableOpacity style={styles.contactButton} onPress={contactOwner}>
              <Text style={styles.contactButtonText}>Contactar al dueño</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Compartir */}
        <ShareButton
          petId={pet.id}
          petName={pet.name}
          petType={pet.type}
          status={pet.status === 'found' ? 'found' : 'lost'}
        />

        {/* Timeline de reportes */}
        {reports && reports.length > 0 && (
          <View style={styles.timelineCard}>
            <Text style={styles.sectionTitle}>
              Historial de reportes ({reports.length})
            </Text>
            {reports.map((report, index) => (
              <View key={report.id} style={styles.timelineItem}>
                <View style={[
                  styles.timelineDot,
                  { backgroundColor: report.status === 'found' ? COLORS.found : report.status === 'sighting' ? COLORS.sighting : COLORS.lost },
                ]} />
                {index < reports.length - 1 && <View style={styles.timelineLine} />}
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineStatus}>
                    {report.status === 'lost' ? 'Perdido' : report.status === 'found' ? 'Encontrado' : 'Avistado'}
                  </Text>
                  {report.location_description && (
                    <Text style={styles.timelineLocation}>
                      📍 {report.location_description}
                    </Text>
                  )}
                  <Text style={styles.timelineDate}>
                    {new Date(report.created_at).toLocaleDateString('es', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 80 }} />
      </View>
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
  imageContainer: { width, height: 300 },
  image: { width: '100%', height: '100%', resizeMode: 'cover' },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { padding: SPACING.lg },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  petName: { fontSize: FONTS.sizes.xxl, fontWeight: '700', color: COLORS.textPrimary, flex: 1 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.sm },
  statusText: { color: COLORS.white, fontSize: 12, fontWeight: '800' },
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
  ownerCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  ownerInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  ownerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  ownerName: { fontSize: FONTS.sizes.md, fontWeight: '600', color: COLORS.textPrimary },
  verifiedText: { fontSize: FONTS.sizes.xs, color: COLORS.success, fontWeight: '600', marginTop: 2 },
  contactButton: {
    backgroundColor: COLORS.whatsapp,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  contactButtonText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },
  timelineCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  timelineItem: { flexDirection: 'row', marginBottom: SPACING.md, position: 'relative' },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginRight: SPACING.md, marginTop: 4 },
  timelineLine: {
    position: 'absolute',
    left: 5,
    top: 16,
    bottom: -SPACING.md,
    width: 2,
    backgroundColor: COLORS.border,
  },
  timelineContent: { flex: 1 },
  timelineStatus: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textPrimary },
  timelineLocation: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  timelineDate: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: 2 },
});
