// ============================================================
// SearchPet - Adoptar Screen
// Directorio de mascotas en adopción, filtrable por ciudad y tipo.
// ============================================================

import { useState } from 'react';
import { PawPlaceholder } from '../components/PawPlaceholder';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAdoptions } from '../../shared/hooks';
import { PetCard } from '../components/PetCard';
import { ListState } from '../components/list/ListState';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS, PET_TYPES } from '../constants';
import type { Pet, PetType, PetListResponse } from '../../shared/types';

export default function AdoptScreen() {
  const router = useRouter();
  const { t } = useTranslation(['adoption', 'pets', 'common']);

  // ── Filtros (draft state — editado libremente, no dispara la API) ──
  const [draftCity, setDraftCity] = useState('');
  const [draftType, setDraftType] = useState<PetType | undefined>();

  // ── Applied state — recién acá se dispara useAdoptions ──
  const [appliedCity, setAppliedCity] = useState<string | undefined>();
  const [appliedType, setAppliedType] = useState<PetType | undefined>();

  const applyFilters = () => {
    setAppliedCity(draftCity.trim() || undefined);
    setAppliedType(draftType);
  };

  const adoptionsQuery = useAdoptions({ city: appliedCity, type: appliedType });
  // `total` y NO `data?.total ?? pets.length`: ese fallback daba CERO con la
  // consulta caída y la pantalla afirmaba "0 resultados". Un cartel de vacío no
  // explica por qué; un contador en cero AFIRMA que se preguntó y no había nada.
  // Sólo se dibuja cuando hubo respuesta.
  const total = adoptionsQuery.data?.total;

  const handlePetPress = (petId: string) => router.push(`/pet/${petId}`);

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>{t('adoption:section.title')}</Text>
        <Text style={styles.subtitle}>{t('adoption:section.subtitle')}</Text>
      </View>

      <View style={styles.filterCard}>
        <TextInput
          style={styles.cityInput}
          placeholder={t('adoption:section.cityPlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          accessibilityLabel={t('adoption:section.cityFilter')}
          value={draftCity}
          onChangeText={setDraftCity}
          returnKeyType="search"
          onSubmitEditing={applyFilters}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          accessibilityLabel={t('adoption:section.typeFilter')}
        >
          <TouchableOpacity
            style={[styles.chip, !draftType && styles.chipActive]}
            onPress={() => setDraftType(undefined)}
          >
            <Text style={[styles.chipText, !draftType && styles.chipTextActive]}>
              🐾 {t('adoption:section.allTypes')}
            </Text>
          </TouchableOpacity>

          {PET_TYPES.map((petType) => (
            <TouchableOpacity
              key={petType.value}
              style={[styles.chip, draftType === petType.value && styles.chipActive]}
              onPress={() =>
                setDraftType(draftType === petType.value ? undefined : (petType.value as PetType))
              }
            >
              <Text
                style={[styles.chipText, draftType === petType.value && styles.chipTextActive]}
              >
                {petType.icon} {t(`pets:types.${petType.value}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity style={styles.applyButton} onPress={applyFilters}>
          <Text style={styles.applyButtonText}>{t('adoption:section.apply')}</Text>
        </TouchableOpacity>
      </View>

      {total != null && (
        <Text style={styles.resultCount}>
          {t('adoption:section.resultCount', { count: total })}
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <ListState<PetListResponse, Pet>
        query={adoptionsQuery}
        // `select` es OBLIGATORIA acá: el hook devuelve el sobre `{data,total}`,
        // no el array. Sin ella la FlatList recibiría el objeto y saldría vacía,
        // sin excepción y sin error de compilación — o sea idéntica a "no hay
        // nada", la misma mentira entrando por la puerta de atrás. El tipo la
        // exige justamente para que no se pueda olvidar.
        select={(res) => res.data}
        // El encabezado va TAMBIÉN adentro del estado de carga, y no es adorno:
        // antes de este cambio los filtros se veían mientras cargaba, porque el
        // spinner vivía en `ListEmptyComponent` debajo del header. Dejarlos
        // afuera se los llevaría en cada apertura de la pantalla.
        loading={
          <View>
            {renderHeader()}
            <View style={styles.center}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          </View>
        }
      >
        {(pets) => (
          // `ListEmptyComponent` se queda DENTRO de la FlatList: "preguntamos y
          // no hay nada" sigue siendo asunto de la lista.
          //
          // TRADE-OFF conocido: en la rama de error el encabezado se va con la
          // lista, así que se pierden los filtros hasta que la consulta ande. Se
          // aceptó porque la acción correcta ante un fallo de red es Reintentar
          // —que el cartel sí ofrece— y no cambiar de ciudad. La alternativa era
          // sacar el encabezado afuera como hace el feed, pero acá mide título +
          // subtítulo + ciudad + chips + botón: fijo se comería la pantalla.
          <FlatList
            data={pets}
            keyExtractor={(item: Pet) => item.id}
            renderItem={({ item }: { item: Pet }) => (
              <PetCard pet={item} onPress={() => handlePetPress(item.id)} />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={renderHeader}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={{ marginBottom: 12 }}><PawPlaceholder size={56} /></View>
                <Text style={styles.emptyText}>{t('adoption:section.empty')}</Text>
              </View>
            }
          />
        )}
      </ListState>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { paddingVertical: SPACING.xxl * 2, alignItems: 'center' },

  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4 },

  // ── Filtros ──
  filterCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    ...SHADOWS.sm,
  },
  cityInput: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  chipsRow: {
    gap: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  applyButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  applyButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.sm },

  resultCount: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },

  // ── Lista ──
  list: { paddingHorizontal: SPACING.lg, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxl * 2 },
  emptyIcon: { fontSize: 60, marginBottom: SPACING.md },
  emptyText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', paddingHorizontal: SPACING.xl },
});
