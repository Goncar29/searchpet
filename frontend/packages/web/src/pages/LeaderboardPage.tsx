import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';
import type { TFunction } from 'i18next';
import { useLeaderboard, useStats } from '@shared/hooks';
import { BADGE_META } from '@shared/types';
import type { LeaderboardEntry } from '@shared/types';
import { Icon } from '../components/Icon';

/** Cuántos badges muestra una fila antes de resumir en "+N". */
const ROW_BADGE_LIMIT = 3;

/** Los tipos de logro que sabemos dibujar, en el orden en que vinieron. */
const knownBadges = (badges?: string[]) => (badges ?? []).filter((b) => BADGE_META[b]);

/**
 * El nombre accesible de un link con logros.
 *
 * Un `aria-label` explícito en un link REEMPLAZA el nombre que se computaría de
 * su contenido, así que los `role="img"` de adentro no entran: quien tabula o
 * usa la lista de links oía sólo "Puesto 4: Persona 4, 148 pts". Los nodos de
 * los logros siguen en el árbol y se alcanzan en modo lectura —eso lo medí— pero
 * el modo con el que se recorre una lista de links es el otro, y ahí no
 * estaban.
 *
 * Va el CONTEO, no los seis nombres: tabular veinte filas escuchando seis
 * logros cada una es peor que no tenerlos. Los nombres siguen disponibles en
 * modo lectura y en la leyenda del costado.
 */
function withBadgeCount(base: string, badges: string[], t: TFunction): string {
  if (badges.length === 0) return base;
  return `${base}, ${t('leaderboard:badgeCount', { count: badges.length })}`;
}

/**
 * Los emojis de badge NO se sustituyen por iconos.
 *
 * `BADGE_META.emoji` vive en `shared/types` y lo consumen ocho archivos de web
 * Y de mobile (ProfilePage, UserProfilePage, esta pagina y tres pantallas
 * nativas). Cambiarlos solo aca haria que el mismo logro se vea distinto en el
 * ranking, en el perfil y en el celular — peor que dejarlos. Es un cambio
 * transversal con su propio PR, y mobile ni siquiera tiene el componente Icon.
 *
 * Lo que si se arregla aca es la ULTIMA PULGADA, que era lo roto: el emoji iba
 * suelto en un <span title=...>. `title` no existe en touch —y el celular es el
 * caso de uso principal— y un lector de pantalla anuncia el nombre Unicode del
 * caracter ("handshake"), no "Primer ayudante". Con `role="img"` y `aria-label`
 * el glifo se queda y el significado por fin viaja.
 */
function BadgeGlyph({ type, className = '' }: { type: string; className?: string }) {
  const { t } = useTranslation('badges');
  const meta = BADGE_META[type];
  if (!meta) return null;
  const label = t(meta.labelKey);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-full bg-primary/10 dark:bg-primary/20 leading-none ${className}`}
    >
      {meta.emoji}
    </span>
  );
}

/** Los badges de una fila: hasta tres, y el resto resumido. */
function RowBadges({ badges, className = '' }: { badges: string[]; className?: string }) {
  const { t } = useTranslation('leaderboard');
  const known = knownBadges(badges);
  if (known.length === 0) return null;

  const shown = known.slice(0, ROW_BADGE_LIMIT);
  const rest = known.length - shown.length;

  return (
    <div className={`flex items-center gap-1 shrink-0 ${className}`}>
      {shown.map((type) => (
        <BadgeGlyph key={type} type={type} className="h-7 w-7 text-sm" />
      ))}
      {rest > 0 && (
        // Un tope de tres no es capricho: son seis badges posibles por veinte
        // filas, y a 390px la fila se parte. El "+N" tiene texto propio para
        // que no quede un numero suelto sin decir de que es.
        //
        // `role="img"` NO es decorativo: ARIA prohibe `aria-label` en elementos
        // genericos y los lectores de pantalla lo ignoran seguido. Sin el rol,
        // medido en el arbol de accesibilidad de Chrome, este nodo salia como
        // `generic` con nombre — o sea la misma clase de bug que el emoji suelto
        // que este PR vino a arreglar, colada en el resumen.
        <span
          role="img"
          aria-label={t('leaderboard:moreBadges', { count: rest })}
          className="inline-flex h-7 items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2 text-xs font-semibold text-gray-500 dark:text-gray-400"
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

/**
 * Avatar con caida a la inicial: no todo el mundo subio foto.
 *
 * `px` es el lado en pixeles que se le pide a Cloudinary, y va explicito porque
 * el tamaño VISIBLE lo decide `className`, que es una cadena de Tailwind: desde
 * adentro no hay forma de leerlo. Si cambia la clase, hay que cambiar el numero
 * — un avatar pedido a la medida equivocada no se ve roto, se ve igual y gasta
 * distinto.
 */
function Avatar({
  entry,
  className,
  px,
  eager = false,
}: {
  entry: LeaderboardEntry;
  className: string;
  px: number;
  eager?: boolean;
}) {
  if (entry.profile_photo_url) {
    return (
      <img
        src={cloudinaryThumb(entry.profile_photo_url, px)}
        alt=""
        // El podio esta SIEMPRE arriba del pliegue y son tres imagenes: diferirlas
        // solo retrasa lo primero que se ve. Las filas si van diferidas — son
        // veinte y la mayoria nace abajo.
        loading={eager ? undefined : 'lazy'}
        className={`${className} rounded-full object-cover bg-gray-100 dark:bg-gray-800`}
      />
    );
  }
  return (
    <div
      className={`${className} rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center font-display font-semibold text-primary`}
    >
      {entry.name.charAt(0).toUpperCase()}
    </div>
  );
}

/**
 * El orden visual del podio (2 - 1 - 3 en escritorio) lo hace CSS, no el DOM.
 * El DOM se queda en 1 - 2 - 3, que es el orden que recorren el teclado y un
 * lector de pantalla, y en celular —donde se apila— es además el orden que se
 * ve, con el ganador arriba.
 *
 * Esto estaba MAL escrito en la primera versión: había puesto el JSX en orden
 * visual y el comentario afirmaba que el DOM quedaba 1-2-3. Lo agarró el test
 * `el DOM lee 1-2-3 aunque el podio se vea 2-1-3`, no yo.
 *
 * Lo usa TAMBIÉN el esqueleto: igualar el alto no sirve si el placeholder
 * grande queda en otra columna que el primer puesto.
 */
const PODIUM_ORDER: Record<number, string> = { 1: 'sm:order-2', 2: 'sm:order-1', 3: 'sm:order-3' };

/**
 * Una plaza del podio. `place` es 1, 2 o 3 y decide el tamaño: el primero va
 * mas grande y elevado. Los medalleros 🥇🥈🥉 que habia antes se fueron por
 * DISEÑO, no por sustitucion de icono — la jerarquia ya la da el tamaño y el
 * numero de puesto, y tres emojis mas competian con los badges de al lado.
 */
function PodiumPlace({ entry, place }: { entry: LeaderboardEntry; place: number }) {
  const { t } = useTranslation('leaderboard');
  const first = place === 1;
  const badges = knownBadges(entry.badges);

  return (
    <Link
      to={`/users/${entry.user_id}`}
      aria-label={withBadgeCount(
        t('leaderboard:podiumAria', { place, name: entry.name, points: entry.total_points }),
        badges,
        t,
      )}
      className={`group flex flex-col items-center text-center ${PODIUM_ORDER[place] ?? ''}`}
    >
      <div className="relative">
        {/* Un `px` por plaza, no uno para las tres: el primero es h-28 (112 css)
            y el segundo y el tercero son h-20 (80). Con 224 fijo, esos dos
            pedian 2,8x su caja — la misma sobre-descarga que este cambio vino a
            cerrar, colada en el unico call site donde un numero servia a dos
            clases distintas. */}
        <Avatar
          entry={entry}
          className={first ? 'h-24 w-24 sm:h-28 sm:w-28' : 'h-20 w-20'}
          px={first ? 224 : 160}
          eager
        />
        <span
          aria-hidden="true"
          className={`absolute -bottom-1 -right-1 flex items-center justify-center rounded-full border-2 border-gray-50 dark:border-gray-950 font-display font-bold text-white ${
            first ? 'h-9 w-9 bg-primary text-base' : 'h-7 w-7 bg-gray-400 dark:bg-gray-600 text-sm'
          }`}
        >
          {place}
        </span>
      </div>

      <div
        className={`mt-4 w-full rounded-2xl border p-4 transition-shadow group-hover:shadow-md ${
          first
            ? 'bg-primary text-white border-primary shadow-sm'
            : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800'
        }`}
      >
        <p
          className={`font-display font-semibold truncate ${
            first ? 'text-lg' : 'text-base text-gray-900 dark:text-gray-100'
          }`}
        >
          {entry.name}
        </p>
        {/* Blanco pleno y no `white/80`: medido sobre `--color-primary`
            (#C24E1A) el blanco pleno da 4.77:1 y al 80% cae a 3.63:1, debajo
            del 4.5:1 que pide WCAG AA. Y esto no es texto decorativo — es el
            puntaje del primer puesto, el dato central del podio. */}
        <p className={`text-sm font-semibold ${first ? 'text-white' : 'text-primary'}`}>
          {entry.total_points} {t('leaderboard:pts')}
        </p>
        {/* El podio tiene lugar, asi que muestra TODOS los logros; el tope de
            tres es de las filas, donde el ancho no da. */}
        {entry.badges && entry.badges.length > 0 && (
          <div className="mt-3 flex items-center justify-center gap-1 flex-wrap">
            {entry.badges
              .filter((b) => BADGE_META[b])
              .map((type) => (
                <BadgeGlyph key={type} type={type} className="h-7 w-7 text-sm" />
              ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const { t } = useTranslation('leaderboard');
  return (
    <Link
      to={`/users/${entry.user_id}`}
      // Sin esto son veinte links que se anuncian igual: el nombre accesible
      // tiene que identificar a la persona (lo mismo que se corrigio en las
      // tarjetas de Refugios, WCAG 2.4.4).
      aria-label={withBadgeCount(
        t('leaderboard:rowAria', {
          rank: entry.rank,
          name: entry.name,
          points: entry.total_points,
        }),
        knownBadges(entry.badges),
        t,
      )}
      className="flex items-center gap-3 sm:gap-4 p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-primary/40 hover:shadow-sm transition-all"
    >
      <span className="w-8 shrink-0 text-center font-display text-lg font-bold text-gray-400 dark:text-gray-500">
        {entry.rank}
      </span>

      <Avatar entry={entry} className="h-11 w-11 shrink-0 text-lg" px={96} />

      {/* En celular los logros bajan a su propia linea debajo de la ciudad; en
          escritorio se acomodan a la derecha del nombre. Van UNA sola vez en el
          DOM: la primera version los tenia en `hidden sm:flex` y desaparecian
          enteros abajo de 640px — o sea justo en el telefono, que es el caso de
          uso principal del proyecto. Medido en la captura, no deducido. */}
      <div className="flex-1 min-w-0 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
            {entry.name}
          </p>
          {entry.city && (
            <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 truncate">
              <Icon name="location-on" className="h-4 w-4 shrink-0" />
              <span className="truncate">{entry.city}</span>
            </p>
          )}
        </div>

        {entry.badges && entry.badges.length > 0 && (
          <RowBadges badges={entry.badges} className="mt-2 sm:mt-0" />
        )}
      </div>

      <div className="shrink-0 text-right">
        <p className="font-display text-base font-bold text-primary">{entry.total_points}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('leaderboard:pts')}</p>
      </div>
    </Link>
  );
}

export function LeaderboardPage() {
  const { t } = useTranslation(['leaderboard', 'badges']);
  const { data: stats } = useStats();

  // Borrador/aplicado: tipear no consulta, solo el submit.
  const [cityDraft, setCityDraft] = useState('');
  const [city, setCity] = useState('');

  const { data: entries, isLoading, error } = useLeaderboard(city, 20);

  const podium = entries?.slice(0, 3) ?? [];
  const rest = entries?.slice(3) ?? [];

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Encabezado */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          {/* Sin el 🏆 que habia antes: el diseño no lleva icono en el titulo y
              la banda ya lo distingue. */}
          <h1 className="font-display text-display-sm md:text-display mb-3">
            {t('leaderboard:title')}
          </h1>
          <p className="text-lg text-white/80 max-w-2xl mx-auto">{t('leaderboard:subtitle')}</p>
        </div>
      </section>

      {/* Buscador de ciudad. El diseño no lo dibuja, pero `useLeaderboard` es
          `enabled: !!city`: sin ciudad no hay ranking que mostrar. */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCity(cityDraft.trim());
            }}
            className="flex flex-col sm:flex-row gap-3 sm:items-center max-w-2xl mx-auto"
          >
            <div className="relative flex-1">
              <Icon
                name="location-on"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-gray-500"
              />
              <input
                type="text"
                value={cityDraft}
                onChange={(e) => setCityDraft(e.target.value)}
                placeholder={t('leaderboard:searchPlaceholder')}
                aria-label={t('leaderboard:cityLabel')}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl shadow-sm hover:bg-primary-dark transition-colors"
            >
              <Icon name="search" className="h-4 w-4" />
              {t('leaderboard:searchButton')}
            </button>
          </form>
        </div>
      </section>

      {/* Ranking + columna lateral */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {!city && (
              <div className="text-center py-16">
                <Icon
                  name="location-on"
                  className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-gray-700"
                />
                <p className="text-gray-500 dark:text-gray-400">{t('leaderboard:enterCity')}</p>
              </div>
            )}

            {city && isLoading && (
              // El esqueleto imita el podio y las filas, no tres barras
              // genericas: si mide distinto que lo que viene despues, el salto
              // de layout es invisible en una captura y en cualquier test.
              <div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end mb-8">
                  {/* El esqueleto usa el MISMO `PODIUM_ORDER` que el podio de
                      verdad. Sin eso el placeholder grande quedaba en la
                      columna 1 y el primer puesto aterrizaba en la 2: medido,
                      272px de salto horizontal al llegar los datos — el salto
                      que el esqueleto existe para evitar. Igualar el alto no
                      alcanza si no se iguala la POSICION. */}
                  {[1, 2, 3].map((place) => (
                    <div
                      key={place}
                      className={`flex flex-col items-center animate-pulse ${PODIUM_ORDER[place]}`}
                    >
                      <div
                        className={`rounded-full bg-gray-200 dark:bg-gray-800 ${
                          place === 1 ? 'h-24 w-24 sm:h-28 sm:w-28' : 'h-20 w-20'
                        }`}
                      />
                      <div className="mt-4 w-full rounded-2xl bg-gray-100 dark:bg-gray-800 h-[7.5rem]" />
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      // Medido contra la fila real, no estimado: 78px en
                      // escritorio (avatar de 44 + p-4 arriba y abajo + borde) y
                      // 114px abajo de 640px, donde los logros bajan a su propia
                      // linea.
                      //
                      // En celular una fila SIN logros mide 78, asi que el
                      // esqueleto no puede calzar con las dos: se elige el caso
                      // frecuente —quien esta en el ranking suele tener alguno—
                      // y el desajuste queda acotado a esa diferencia, en vez de
                      // errarle a todas.
                      className="h-[7.125rem] sm:h-[4.875rem] rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* `!entries?.length` en la guarda del error, no `error` a secas:
                React Query CONSERVA los datos cacheados cuando falla un
                refetch, y ahi `isLoading` es false. Con la guarda anterior, un
                fallo pasajero —el cold start de Render tras dormirse, un 502—
                reemplazaba un ranking ya dibujado por el cartel de error.
                Mostrar datos viejos es mejor que borrar los que estan. */}
            {city && error && !entries?.length && (
              <div className="text-center py-16">
                <Icon
                  name="warning"
                  className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-gray-700"
                />
                <p className="text-gray-500 dark:text-gray-400">{t('leaderboard:loadError')}</p>
              </div>
            )}

            {city && !isLoading && !error && entries && entries.length === 0 && (
              <div className="text-center py-16">
                <Icon
                  name="search"
                  className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-gray-700"
                />
                <p className="text-gray-700 dark:text-gray-300 font-semibold mb-1">
                  {t('leaderboard:empty', { city })}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('leaderboard:emptyHint')}
                </p>
              </div>
            )}

            {city && !isLoading && entries && entries.length > 0 && (
              <>
                {/* `items-end` para que el primero, que es mas alto, quede
                    parado sobre la misma linea de base que los otros dos. */}
                {/* DOM en 1-2-3; el 2-1-3 de escritorio lo pone `PODIUM_ORDER`. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end mb-8">
                  {podium.map((p: LeaderboardEntry, i: number) => (
                    <PodiumPlace key={p.user_id} entry={p} place={i + 1} />
                  ))}
                </div>

                {rest.length > 0 && (
                  <div className="space-y-3">
                    {rest.map((entry: LeaderboardEntry) => (
                      <LeaderboardRow key={entry.user_id} entry={entry} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Columna lateral: la leyenda de logros y el impacto. En celular baja
              debajo del ranking, que es lo que la persona vino a ver. */}
          <aside className="lg:col-span-1 space-y-6">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
              <h2 className="font-display text-headline text-gray-900 dark:text-gray-100 mb-1">
                {t('badges:achievementsTitle')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                {t('badges:achievementsSubtitle')}
              </p>
              <ul className="space-y-4">
                {Object.entries(BADGE_META).map(([key, meta]) => (
                  <li key={key} className="flex items-start gap-3">
                    <BadgeGlyph type={key} className="h-9 w-9 text-base shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {t(meta.labelKey)}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t(meta.howToEarnKey)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-dark text-white p-6">
              <Icon name="celebration" className="h-7 w-7 mb-3" />
              <p className="font-display text-display-sm">{stats?.pets_reunited ?? 0}</p>
              <p className="text-sm text-white/70">{t('leaderboard:statReunited')}</p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6">
              <Icon name="person" className="h-7 w-7 mb-3 text-primary" />
              <p className="font-display text-display-sm text-gray-900 dark:text-gray-100">
                {stats?.total_users ?? 0}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('leaderboard:statHelpers')}
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
