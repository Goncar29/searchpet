import { useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import type { StrayCandidate } from '../../../shared/types';
import { cloudinaryThumb } from '../../../shared/utils/cloudinaryThumb';
import { ListState } from '../list/ListState';
import { IMAGE_SIZES } from '../../constants/imageSizes';
import { getDateLocale } from '../../i18n/dateLocale';
import { COLORS, SPACING, FONTS } from '../../constants';

interface CandidatesStepProps {
  query: UseQueryResult<StrayCandidate[]>;
  /** El usuario dice que es este animal: se reporta sobre la ficha existente. */
  onSelect: (candidate: StrayCandidate) => void;
  /** No hay nada que preguntar, o el usuario decidió seguir igual: al alta. */
  onSkip: () => void;
  /**
   * El alta está en vuelo. Apaga la salida, que es la que PUBLICA.
   *
   * `LocationStep` ya protegía así su botón de publicar; al mover la
   * publicación a este paso había que traerse la protección con ella. Sin esto,
   * dos toques seguidos son dos mascotas — el mismo duplicado que el paso viene
   * a evitar, por la vía manual en vez de la del efecto.
   */
  isPublishing?: boolean;
}

/**
 * "¿No es alguno de estos?" — el paso que evita el callejero duplicado.
 *
 * Espeja `web/src/components/publish/CandidatesStep.tsx`: mismas tres reglas,
 * mismas claves i18n (viven en `shared/i18n`, así que mobile las tiene gratis).
 *
 * 1. **Con cero candidatos no se muestra**, y llama a `onSkip`. Preguntar por
 *    una lista vacía es hacerle perder un paso a la persona.
 * 2. **Si la consulta FALLA, sí se muestra**, con el cartel y "Publicar igual".
 *    Saltear en silencio pintaría "no hay candidatos" cuando en realidad no
 *    pudimos preguntar, y acá el precio de esa mentira es justo el duplicado.
 * 3. **Nunca bloquea.** Un 500 no puede impedir que alguien publique un animal
 *    que está en la calle ahora.
 *
 * Una divergencia con la web, y es del `ListState` de cada plataforma: el de
 * mobile NO tiene slot `empty` —la lista maneja su propio vacío— así que acá no
 * se pasa. Da igual: el vacío ya se fue en la rama de arriba.
 */
export function CandidatesStep({ query, onSelect, onSkip, isPublishing }: CandidatesStepProps) {
  const { t, i18n } = useTranslation();

  // `query.data` y no `items.length`: una lista vacía que SÍ llegó es una
  // respuesta ("no hay ninguno cerca") y el paso sobra. Un error deja `data` en
  // undefined y NO tiene que saltear.
  const sinCandidatos = query.data != null && query.data.length === 0;

  // El salteo automático corre UNA sola vez, y el ref es lo que lo garantiza.
  // `onSkip` cambia de identidad en cada render del wizard y publicar es
  // asíncrono, así que con `onSkip` en las dependencias el efecto se volvería a
  // disparar y crearía una SEGUNDA mascota.
  const yaSalteo = useRef(false);

  useEffect(() => {
    // `isPublishing` frena el salteo igual que frena el botón, y por el mismo
    // motivo: `onSkip` PUBLICA. El ref solo—que era lo que había—cubre el
    // re-render, no el cambio de respuesta. Con la consulta caída, quien toca
    // "Publicar igual" deja un alta en vuelo mientras `sinCandidatos` sigue en
    // false; si un refetch (el "Reintentar" del ListState, o el reconnect que
    // cablea `utils/onlineStatus`) devuelve `[]`, el flanco enciende el efecto
    // con `yaSalteo` todavía en false y sale un SEGUNDO alta.
    if (!sinCandidatos || yaSalteo.current || isPublishing) return;
    yaSalteo.current = true;
    onSkip();
  }, [sinCandidatos, onSkip, isPublishing]);

  if (sinCandidatos) return null;

  // La fecha en que se lo vio, en el idioma del usuario.
  //
  // `toLocaleDateString` y NO `Intl.RelativeTimeFormat`, que es lo que hacía la
  // web y se portó tal cual acá. Hermes —el motor de Expo SDK 52, y no hay
  // polyfill en este paquete— implementa un subconjunto de `Intl`, y este es el
  // ÚNICO lugar de mobile que pedía ese constructor: los otros seis sitios que
  // formatean fechas usan `toLocaleDateString`. Como esto corre en el cuerpo del
  // render, un constructor ausente no degrada la fecha, revienta el paso entero
  // — y justo cuando SÍ hay un candidato, que es el único caso en que se dibuja.
  //
  // El codebase no podía avisar: el otro `Intl` exótico que mobile toca es el
  // `Intl.PluralRules` de i18next, que va envuelto en try/catch con fallback, así
  // que los plurales andando no probaban nada sobre el motor.
  //
  // `getDateLocale` en vez del idioma pelado: siempre devuelve un tag válido, lo
  // que de paso cierra el RangeError que el código anterior esquivaba a mano.
  const cuandoSeLoVio = (iso: string): string =>
    new Date(iso).toLocaleDateString(getDateLocale(i18n.language), {
      day: 'numeric',
      month: 'long',
    });

  return (
    <View>
      <Text style={styles.title}>{t('publish:candidates.title')}</Text>
      <Text style={styles.subtitle}>{t('publish:candidates.subtitle')}</Text>

      <ListState
        query={query}
        loading={<View style={styles.skeleton} />}
        errorTitle={t('publish:candidates.errorTitle')}
        errorBody={t('publish:candidates.errorBody')}
      >
        {(items) => (
          <View style={styles.list}>
            {items.map((c) => (
              <View key={c.id} style={styles.card}>
                {c.photo_url ? (
                  <Image
                    // `IMAGE_SIZES.thumb` (128) es justo la variante documentada
                    // para "miniatura del wizard": caja de 56 dp a 3x.
                    source={{ uri: cloudinaryThumb(c.photo_url, IMAGE_SIZES.thumb) }}
                    style={styles.photo}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.photo, styles.photoEmpty]}>
                    <Text style={styles.paw}>🐾</Text>
                  </View>
                )}
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {/* La fecha, NUNCA la palabra "vencido": es jerga nuestra,
                      sugiere que el animal ya no está, y lo que la persona
                      necesita para reconocerlo es cuándo se lo vio. Y dice "por
                      acá" porque el reloj es la última vista DENTRO del radio
                      consultado, no la última vista en cualquier lado. */}
                  <Text style={styles.meta}>
                    {/* `lastSeenOn` y no `lastSeen`: la web pasa un relativo
                        ("hace 4 meses") y acá va una fecha, así que cada frase
                        necesita su preposición. Comparten el resto del
                        namespace; se separan sólo en esta línea. */}
                    {t('publish:candidates.lastSeenOn', { date: cuandoSeLoVio(c.last_seen_nearby_at) })}
                  </Text>
                  <Text style={styles.distance}>
                    {t('publish:candidates.distance', { meters: Math.round(c.distance_meters) })}
                  </Text>
                </View>
                {/* Deshabilitado mientras hay un alta en vuelo, por lo mismo
                    que el botón de salida: si no, tocar "Publicar igual" y
                    después "Es este" deja una mascota nueva Y un avistamiento
                    sobre la vieja — las dos cosas que el paso existe para que
                    no pasen a la vez. */}
                <TouchableOpacity
                  style={[styles.selectButton, isPublishing && styles.skipDisabled]}
                  onPress={() => onSelect(c)}
                  disabled={isPublishing}
                  accessibilityRole="button"
                >
                  <Text style={styles.selectText}>{t('publish:candidates.isThisOne')}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ListState>

      {/* Fuera del ListState a propósito: tiene que estar TAMBIÉN cuando la
          consulta falló, que es justo cuando el usuario no ve ninguna tarjeta y
          más necesita una salida. */}
      <TouchableOpacity
        testID="candidates-skip"
        style={[styles.skipButton, isPublishing && styles.skipDisabled]}
        onPress={onSkip}
        // `disabled` es la ÚNICA fuente, y eso es deliberado: TouchableOpacity
        // ya deriva de él `accessibilityState.disabled`. Pasar además el
        // accessibilityState a mano no agrega nada Y ROMPE EL TEST — medido:
        // React Native Testing Library bloquea el press mirando ese estado, así
        // que con los dos puestos, sacar `disabled` dejaba la suite en verde
        // mientras en un device el botón seguía respondiendo. Una fuente sola
        // hace que el test mida el material.
        disabled={isPublishing}
        accessibilityRole="button"
      >
        {/* El texto sigue a lo que la persona TIENE DELANTE, y son TRES
            estados, no dos. Sin datos no vio ninguna tarjeta, así que "ninguno
            de estos" no se refiere a nada — pero "publicar igual" tampoco vale
            mientras la consulta sigue en vuelo: afirma que ya miró y descartó,
            cuando lo que pasa es que todavía no llegaron. Con `data == null` a
            secas los dos son indistinguibles, porque en los dos `data` es
            undefined.

            Acá pesa MÁS que en la web: en red móvil la ventana de carga es
            larga y la gente toca rápido, así que ésta es la vía más probable de
            que el paso no cumpla su función — más que un 500, que al menos
            muestra un cartel explicando qué pasó.

            El botón NO se deshabilita durante la carga, y es deliberado: este
            paso nunca bloquea a alguien apurado con un animal en la calle.

            La condición es "hay una consulta EN VUELO ahora mismo", y eso no
            es lo mismo que `isLoading`: ése cubre sólo el PRIMER intento, y
            deja afuera el refetch después de un error — la persona toca
            "Reintentar", `status` sigue en `'error'`, y por eso `isLoading`
            se queda en false durante todo el despertar de Render, que son 30s
            o más.

            `isPaused` NO va acá, y estuvo un rato puesto por error. Sin
            conectividad la consulta está detenida: no hay ninguna espera en
            curso, y `ListState` ya pinta "cuando vuelva la conexión, probá de
            nuevo". Decir "publicar sin esperar" ahí anuncia una espera que no
            está ocurriendo; lo honesto es "publicar igual", igual que ante un
            error.

            El `data == null` es el que deja "ninguno de estos" para cuando la
            persona SÍ vio las tarjetas: un refetch con datos ya en pantalla no
            cambia lo que tiene delante.

            Nunca `isPending`: en React Query v5 una query con `enabled: false`
            queda en `pending` para siempre, y ésta está gateada por el paso
            (regla #60). */}
        <Text style={styles.skipText}>
          {query.isFetching && query.data == null
            ? t('publish:candidates.publishWithoutWaiting')
            : query.data == null
              ? t('publish:candidates.publishAnyway')
              : t('publish:candidates.noneOfThem')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  skeleton: {
    height: 160,
    borderRadius: 12,
    backgroundColor: COLORS.border,
  },
  list: {
    gap: SPACING.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  photo: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: COLORS.border,
  },
  photoEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  paw: {
    fontSize: 24,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  meta: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  distance: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  selectButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },
  selectText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: FONTS.sizes.sm,
  },
  skipButton: {
    marginTop: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  skipDisabled: {
    opacity: 0.5,
  },
  skipText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
});
