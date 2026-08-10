// ============================================================
// SearchPet - PetCard Component
// ============================================================

import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';
import type { Report, Pet } from '../../shared/types';
import { PawPlaceholder } from './PawPlaceholder';

interface PetCardProps {
  /** Modo feed: reporte con mascota anidada (nearby reports) */
  report?: Report;
  /** Modo búsqueda: mascota directa (search results) */
  pet?: Pet;
  onPress: () => void;
}

export function PetCard({ report, pet: petProp, onPress }: PetCardProps) {
  const { t, i18n } = useTranslation(['pets', 'common']);
  // report tiene prioridad; petProp es para resultados de búsqueda directa
  const pet = report?.pet ?? petProp;

  // Estado de display: desde report (lost/found/sighting) o desde pet
  // (el status real de la mascota — antes se forzaba a 'lost' salvo 'found',
  // lo que mostraba "PERDIDO" para mascotas en adopción/stray/etc.)
  const rawStatus = report?.status ?? petProp?.status ?? 'lost';
  const dateStr = report?.created_at ?? petProp?.created_at ?? '';
  const locationDesc = report?.location_description;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'lost': return COLORS.lost;
      case 'found': return COLORS.found;
      case 'sighting': return COLORS.sighting;
      case 'adoption': return '#7E22CE';
      default: return COLORS.primary;
    }
  };

  // Regla #13: los badges salen de i18n, nunca de etiquetas hardcodeadas.
  // Estas cuatro claves YA existían en los tres idiomas — el componente
  // simplemente nunca las usó, así que un usuario en inglés leía "PERDIDO".
  //
  // El `toUpperCase` va acá y no en las traducciones: la mayúscula es
  // presentación del badge, no parte del texto. Si mañana el diseño lo quiere
  // en minúscula, se cambia en un lugar y no en nueve entradas de locale.
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'lost': return t('pets:card.lost').toUpperCase();
      case 'found': return t('pets:card.found').toUpperCase();
      case 'sighting': return t('pets:card.sighting').toUpperCase();
      case 'adoption': return t('pets:status.adoption').toUpperCase();
      default: {
        // El default NO puede devolver el enum crudo. En modo búsqueda el feed
        // monta este card con `pet=`, y `stray` está en PublicSearchableStatuses
        // y FeedVisibleStatuses: filtrando por tipo o color aparecían callejeras
        // con el badge diciendo literalmente "STRAY", en los tres idiomas.
        //
        // pets:status.<status> cubre los siete estados. Si aún así no hubiera
        // traducción, i18next devuelve la clave — feo, pero visible, que es
        // mejor que un enum que parece texto de producto.
        const traducido = t(`pets:status.${status}`);
        return traducido.toUpperCase();
      }
    }
  };

  const getTimeAgo = (d: string) => {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    // common:timeAgo YA existía en los tres idiomas con exactamente este
    // formato compacto, y nadie la había cableado. Sin esto, un usuario en
    // inglés veía "LOST" y "No name" traducidos AL LADO de "hace 5 min", en el
    // mismo encabezado del card — mezclado es peor que todo en español.
    if (diffMins < 1) return t('common:timeAgo.now');
    if (diffMins < 60) return t('common:timeAgo.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('common:timeAgo.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('common:timeAgo.daysAgo', { count: diffDays });
    return date.toLocaleDateString(i18n.language);
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
            <PawPlaceholder size={48} />
          </View>
        )}
        {/* Badge de status */}
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: getStatusColor(rawStatus) },
          ]}
        >
          <Text style={styles.statusText}>{getStatusLabel(rawStatus)}</Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.infoHeader}>
          <Text style={styles.petName} numberOfLines={1}>
            {pet?.name || t('pets:card.noName')}
          </Text>
          <Text style={styles.timeAgo}>{getTimeAgo(dateStr)}</Text>
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

        {locationDesc && (
          <Text style={styles.location} numberOfLines={1}>
            📍 {locationDesc}
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
