// ============================================================
// SearchPet — Tabla de Líderes
// Muestra el ranking de usuarios por puntos en una ciudad.
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useLeaderboard, useCiudadDecidida } from '../../../shared/hooks';
import { useAuthStore } from '../../store';
import { ListState } from '../../components/list/ListState';
import { LIGHT_COLORS, SPACING, FONTS, RADIUS, SHADOWS, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { IconLabel } from '../../components/IconLabel';
import { BADGE_META } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { PointsRulesModal } from '../../components/PointsRulesModal';
import type { LeaderboardEntry } from '../../../shared/types';

/**
 * La caída para las cuentas SIN ciudad — las anteriores a que fuera obligatoria
 * en el alta. Es el default del proyecto (regla #10), y esta pantalla lo usa
 * porque no tiene estado vacío para "todavía no sé tu ciudad"; web sí lo tiene
 * y por eso no pasa ninguno.
 *
 * Estaba escrito dos veces en los `useState` de abajo. Acá arriba y con nombre
 * queda claro que es una CAÍDA y no la ciudad de quien mira, que es justo la
 * confusión que rompía la pantalla.
 */
const DEFAULT_CITY = 'Montevideo';

// Medal colors are shared by both palettes, so a module-level map is safe.
const MEDAL_COLOR: Record<number, string> = {
  1: LIGHT_COLORS.medalGold,
  2: LIGHT_COLORS.medalSilver,
  3: LIGHT_COLORS.medalBronze,
};

function getInitials(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

// Achievements legend: explains what each badge is and how a user earns it.
function AchievementsLegend() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation(['leaderboard', 'pointsRules']);
  const [rulesOpen, setRulesOpen] = useState(false);
  return (
    <View style={styles.achievements}>
      <View style={styles.achievementsHeader}>
        <IconLabel icon="military-tech" size={18} color={colors.textPrimary} gap={SPACING.xs} style={{ flex: 1 }}>
          <Text style={[styles.achievementsTitle, { marginBottom: 0 }]}>{t('badges:achievementsTitle')}</Text>
        </IconLabel>
        <TouchableOpacity
          onPress={() => setRulesOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('pointsRules:open')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="help" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <PointsRulesModal visible={rulesOpen} onClose={() => setRulesOpen(false)} />
      <Text style={styles.achievementsSubtitle}>{t('badges:achievementsSubtitle')}</Text>
      {Object.entries(BADGE_META).map(([key, meta]) => (
        <View key={key} style={styles.achievementRow}>
          <View style={styles.achievementIcon}>
            <Icon name={meta.icon} size={20} color={colors.primary} />
          </View>
          <View style={styles.achievementTextWrap}>
            <Text style={styles.achievementName}>{t(meta.labelKey)}</Text>
            <Text style={styles.achievementHow}>{t(meta.howToEarnKey)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function LeaderboardRow({ entry, onPress }: { entry: LeaderboardEntry; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const medal = MEDAL_COLOR[entry.rank];

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {/* Rank */}
      <View style={styles.rankContainer}>
        {medal ? (
          <Icon
            name="workspace-premium"
            size={26}
            color={medal}
            accessibilityLabel={`#${entry.rank}`}
          />
        ) : (
          <Text style={styles.rankNumber}>{entry.rank}</Text>
        )}
      </View>

      {/* Avatar */}
      <View style={[styles.avatar, medal ? styles.avatarTop3 : null]}>
        <Text style={styles.avatarText}>{getInitials(entry.name)}</Text>
      </View>

      {/* Name */}
      <Text style={styles.rowName} numberOfLines={1}>{entry.name}</Text>

      {/* Points */}
      <View style={styles.pointsContainer}>
        <Text style={styles.pointsValue}>{entry.total_points}</Text>
        <Text style={styles.pointsLabel}>pts</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function LeaderboardScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('leaderboard');

  // Arranca VACÍA, no en 'Montevideo'.
  //
  // El default del proyecto (regla #10) sigue siendo la caída para las cuentas
  // sin ciudad, pero ahora lo aplica el hook y sólo DESPUÉS de que la sesión se
  // resolvió. Cableado en el `useState` inicial, la query salía disparada en el
  // primer render: alguien de Salto veía un ranking de Montevideo, rotulado
  // como propio, mientras su sesión viajaba. Es el mismo "plausible, silencioso
  // y equivocado" que esta pantalla vino a eliminar, en una ventana más corta.
  //
  // Con `''` la query queda deshabilitada (`enabled: !!city`), así que no se
  // consulta nada hasta saber qué ciudad corresponde.
  const [city, setCity] = useState('');
  const [inputCity, setInputCity] = useState('');

  const usuario = useAuthStore((state) => state.user);
  // `isLoading` del store es lo que distingue "todavía no sé tu ciudad" de "sé
  // que no tenés": sin ese dato no se puede decidir si corresponde el default.
  const cargandoSesion = useAuthStore((state) => state.isLoading);

  // La política vive en `useCiudadDecidida`, compartido con web. Acá sólo queda
  // qué estado tocar y cuál es la caída.
  const { decidirManualmente } = useCiudadDecidida({
    userId: usuario?.id,
    ciudadDelPerfil: usuario?.city,
    sesionResuelta: !cargandoSesion,
    fallback: DEFAULT_CITY,
    aplicar: (ciudad) => {
      setCity(ciudad);
      setInputCity(ciudad);
    },
  });

  // La query entera y no sólo `data`: `ListState` necesita `isPaused`,
  // `isError` y `refetch` para decidir entre cartel, franja y lista.
  const leaderboardQuery = useLeaderboard(city);
  const { isLoading, isFetching, refetch } = leaderboardQuery;

  // El mismo nodo para las dos esperas —la sesión que todavía no resolvió y la
  // consulta en vuelo— porque para quien mira son la misma cosa.
  const cargando = (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );

  // Buscar a mano DECIDE la ciudad: el perfil que llegue tarde ya no la pisa.
  // La guarda del vacío vive en el hook y devuelve `null` — acá importa más que
  // en web, porque esto cuelga también de `onBlur`: alcanza con tocar afuera
  // del campo para dispararlo.
  const applyCity = () => {
    const buscada = decidirManualmente(inputCity);
    if (!buscada) return;
    setCity(buscada);
  };

  return (
    <View style={styles.container}>
      {/* City filter */}
      <View style={styles.filterContainer}>
        <Text style={styles.filterLabel}>{t('leaderboard:cityLabel')}</Text>
        <TextInput
          style={styles.filterInput}
          value={inputCity}
          onChangeText={setInputCity}
          placeholder={t('leaderboard:cityPlaceholder')}
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          onSubmitEditing={applyCity}
          onBlur={applyCity}
        />
      </View>

      {/* El cartel de error se muestra SÓLO si no hay nada que mostrar. Antes
          era `isError ?` a secas y reemplazaba la tabla entera: React Query
          conserva lo cacheado cuando falla un refetch, y esta pantalla tiene
          pull-to-refresh, o sea que un 502 pasajero de Render —el cold start—
          borraba el ranking que el usuario estaba mirando. Ahora eso cae en la
          franja de "datos de hace un rato" y la tabla se queda.

          El filtro de ciudad queda AFUERA a propósito: es lo que permite
          reintentar con otra ciudad, y perderlo en la rama de error dejaría la
          pantalla sin salida.

          Sin `errorTitle`/`errorBody`: los defaults de `common` ("No pudimos
          cargar esta lista") son ciertos también en la rama offline, mientras
          que `leaderboard:loadError` decía sólo "Error al cargar". */}
      {/* Los genéricos van EXPLÍCITOS: sin ellos `TItem` infiere `unknown` y la
          `FlatList` de abajo lo rechaza (TS2769). Jest no lo ve —Babel no
          chequea tipos— así que esto sólo aparece corriendo `tsc`. */}
      {/* MIENTRAS NO SEPAMOS QUÉ CIUDAD CORRESPONDE, va el spinner y no la
          lista.
          Sin ciudad la query está deshabilitada (`enabled: !!city`), y una query
          deshabilitada NO es `isLoading`: queda `pending` con `isFetching` en
          false, así que `ListState` la deja pasar hasta la lista vacía y el
          `ListEmptyComponent` dibuja "no hay nadie en ." — con la ciudad en
          blanco y afirmando algo que nadie preguntó.
          Este estado NO existía antes de que la pantalla arrancara vacía: con
          'Montevideo' cableado la query salía siempre habilitada. Lo destapó el
          code review de este mismo PR. */}
      {!city ? (
        cargando
      ) : (
      <ListState<LeaderboardEntry[], LeaderboardEntry>
        query={leaderboardQuery}
        loading={cargando}
      >
        {(entries) => (
        <FlatList<LeaderboardEntry>
          data={entries}
          keyExtractor={(item) => item.user_id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              <AchievementsLegend />
              <IconLabel
                testID="leaderboard-city-header"
                icon="location-city"
                size={20}
                color={colors.textPrimary}
                gap={SPACING.xs}
                style={styles.sectionHeader}
              >
                <Text style={styles.sectionTitle}>{city}</Text>
              </IconLabel>
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Icon name="search" size={56} color={colors.textMuted} /></View>
              <Text style={styles.emptyTitle}>{t('leaderboard:emptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('leaderboard:empty', { city })}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <LeaderboardRow
              entry={item}
              onPress={() => router.push('/users/' + item.user_id)}
            />
          )}
          contentContainerStyle={styles.listContent}
        />
        )}
      </ListState>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },

  // ── Auth guard / Error states ──
  guardIcon: { fontSize: 56, marginBottom: SPACING.md },
  guardTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: c.textPrimary, marginBottom: SPACING.sm },
  guardText: { fontSize: FONTS.sizes.sm, color: c.textSecondary, textAlign: 'center', marginBottom: SPACING.lg },

  retryButton: {
    borderWidth: 1,
    borderColor: c.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
  },
  retryButtonText: { color: c.primary, fontSize: FONTS.sizes.sm, fontWeight: '600' },

  // ── City filter ──
  filterContainer: {
    backgroundColor: c.surface,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  filterLabel: {
    fontSize: FONTS.sizes.xs,
    fontWeight: '600',
    color: c.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterInput: {
    backgroundColor: c.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONTS.sizes.sm,
    color: c.textPrimary,
    borderWidth: 1,
    borderColor: c.border,
  },

  // ── Achievements legend ──
  achievements: {
    backgroundColor: c.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  achievementsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  achievementsTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: c.textPrimary,
    marginBottom: 2,
  },
  achievementsSubtitle: {
    fontSize: FONTS.sizes.xs,
    color: c.textSecondary,
    marginBottom: SPACING.md,
  },
  achievementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  achievementIcon: { marginRight: SPACING.sm, marginTop: 1 },
  achievementTextWrap: { flex: 1 },
  achievementName: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: c.textPrimary },
  achievementHow: { fontSize: FONTS.sizes.xs, color: c.textSecondary },

  // ── List ──
  listContent: { paddingBottom: 80 },
  // The list has no horizontal padding, so the inset goes on the row that holds
  // the icon AND the city: on the text alone it left the icon on the screen edge.
  sectionHeader: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: c.textPrimary,
  },

  // ── Row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  rankContainer: { width: 32, alignItems: 'center', marginRight: SPACING.sm },
  rankNumber: { fontSize: FONTS.sizes.md, fontWeight: '700', color: c.textSecondary },

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.secondary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarTop3: { backgroundColor: c.accent + '30' },
  avatarText: { fontSize: FONTS.sizes.md, fontWeight: '700', color: c.secondary },

  rowName: { flex: 1, fontSize: FONTS.sizes.md, fontWeight: '500', color: c.textPrimary },

  pointsContainer: { alignItems: 'flex-end' },
  pointsValue: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: c.primary },
  pointsLabel: { fontSize: FONTS.sizes.xs, color: c.textMuted },

  // ── Empty state ──
  empty: { alignItems: 'center', padding: SPACING.xl, marginTop: SPACING.lg },
  emptyIcon: { marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.sizes.lg, fontWeight: '700', color: c.textPrimary, marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sizes.sm, color: c.textSecondary, textAlign: 'center', lineHeight: 22 },
});
