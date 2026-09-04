import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMyPets } from '@shared/hooks';
import { useAuthStore } from '../../store';
import type { Pet, Photo } from '../../../shared/types';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';
import { PawPlaceholder } from '../PawPlaceholder';
import { ListState } from '../list/ListState';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';
import { IMAGE_SIZES } from '../../constants/imageSizes';

interface LostPetStepProps {
  onSelect: (pet: Pet) => void;
}

export function LostPetStep({ onSelect }: LostPetStepProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const petsQuery = useMyPets(isAuthenticated);

  return (
    // Sin esto, una consulta CAIDA se leia como "no tenes ninguna mascota".
    // `pets` en undefined dejaba `eligiblePets` vacio y `ownsAnyPet` en false, o
    // sea el cartel de "registrate una" con su boton a /pets/register: al dueno
    // de una mascota se le pedia registrarla DE NUEVO, y el duplicado que sale
    // de ahi nace de un error de red. Es peor que en una lista cualquiera,
    // porque el cartel no solo miente: empuja a crear datos malos.
    //
    // NO se pasa `errorTitle`: el titulo por defecto nombra la falla de carga y
    // ese texto tambien se usa en la rama offline, asi que uno especifico de
    // esta seccion tendria que servir para las dos causas. El generico ya lo hace.
    //
    // Ojo con la rama `isPending`: sin sesion `useMyPets` va con `enabled:false`
    // y cae en `children([])`, o sea el cartel de vacio con su boton — que es
    // exactamente lo que esta pantalla mostraba antes. El porte no le cambia el
    // significado a ningun estado que ya existiera.
    // Los genericos van EXPLICITOS. Sin ellos `TItem` se resuelve a `unknown`:
    // su default (`TData extends (infer U)[] ? U : never`) no llega a aplicarse
    // porque `SelectProp` referencia los dos parametros a la vez, y el resultado
    // es que `pets.filter(...)` deja de tipar contra `Pet`. El feed no lo sufre
    // porque pasa `select`, que fija `TItem` por inferencia; acá `select` es
    // opcional (el hook ya devuelve el array pelado) y no hay de donde sacarlo.
    <ListState<Pet[], Pet>
      query={petsQuery}
      loading={<Text style={styles.loading}>{t('common:loading')}</Text>}
    >
      {(pets) => {
        // Sólo una mascota `registered` puede pasar a `lost`: las demás ya están
        // en un estado terminal o en una búsqueda activa.
        const eligiblePets = pets.filter((pet: Pet) => pet.status === 'registered');
        // Mismo filtro que la pestaña "Mis mascotas" del destino (my-pets.tsx
        // deja las publicaciones de adopción en su propia pestaña). Contar TODAS
        // mandaba a quien sólo tiene una en adopción a una pestaña vacía que le
        // dice que no tiene mascotas: la misma contradicción, una pantalla más
        // adelante.
        const ownsAnyPet = pets.some(
          (pet: Pet) => pet.status !== 'adoption' && pet.status !== 'adopted',
        );

        // Mismo defecto que en la web: al dueño de una mascota se le decía que
        // no tenía ninguna registrada. Acá el destino ya era el correcto (Mis
        // mascotas), pero el texto seguía siendo el de "no tenés ninguna", que
        // para ese usuario es falso. Que el estado no sea elegible es un detalle
        // de implementación.
        if (eligiblePets.length === 0) {
          return (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {ownsAnyPet ? t('publish:lostPet.noneEligible') : t('publish:lostPet.empty')}
              </Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => router.push(ownsAnyPet ? '/my-pets' : '/pets/register')}
                accessibilityRole="button"
              >
                <Text style={styles.emptyButtonText}>
                  {ownsAnyPet
                    ? t('publish:lostPet.noneEligibleAction')
                    : t('publish:lostPet.emptyAction')}
                </Text>
              </TouchableOpacity>
            </View>
          );
        }

        return (
          <View>
            <Text style={styles.title}>{t('publish:lostPet.title')}</Text>
            {eligiblePets.map((pet: Pet) => {
              const primaryPhoto: Photo | undefined =
                pet.photos?.find((p) => p.is_primary) ?? pet.photos?.[0];

              return (
                <TouchableOpacity
                  key={pet.id}
                  style={styles.row}
                  onPress={() => onSelect(pet)}
                  accessibilityRole="button"
                >
                  {primaryPhoto ? (
                    <Image
                      source={{ uri: cloudinaryThumb(primaryPhoto.url, IMAGE_SIZES.thumb) }}
                      style={styles.thumb}
                    />
                  ) : (
                    <View style={styles.thumbPlaceholder}>
                      <PawPlaceholder size={28} />
                    </View>
                  )}
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{pet.name}</Text>
                    <Text style={styles.rowType}>{t(`pets:types.${pet.type}`)}</Text>
                  </View>
                  <Text style={styles.selectLabel}>{t('publish:lostPet.select')}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      }}
    </ListState>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.lg, textAlign: 'center' },
  loading: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.lg },
  emptyContainer: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, marginBottom: SPACING.md, textAlign: 'center' },
  emptyButton: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg },
  emptyButtonText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.sizes.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.md, marginRight: SPACING.md },
  thumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.md,
    marginRight: SPACING.md,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderText: { fontSize: 24 },
  rowInfo: { flex: 1 },
  rowName: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary },
  rowType: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: SPACING.xs },
  selectLabel: { color: COLORS.primary, fontWeight: '700', fontSize: FONTS.sizes.sm },
});
