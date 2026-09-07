import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import type { StrayCandidate } from '@shared/types';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';
import { ListState } from '../list/ListState';
import { PawPlaceholder } from '../PawPlaceholder';

interface CandidatesStepProps {
  query: UseQueryResult<StrayCandidate[]>;
  /** El usuario dice que es este animal: se reporta sobre la ficha existente. */
  onSelect: (candidate: StrayCandidate) => void;
  /** No hay nada que preguntar, o el usuario decidió seguir igual: al alta. */
  onSkip: () => void;
  /**
   * El alta está en vuelo. Deshabilita la salida, que es la que PUBLICA.
   *
   * No es cosmético: `LocationStep` ya protegía su botón de publicar así, y al
   * mover la publicación a este paso había que traerse la protección con ella.
   * Sin esto, dos clicks seguidos son dos mascotas — el mismo duplicado que el
   * paso viene a evitar, por la vía manual en vez de la del efecto.
   */
  isPublishing?: boolean;
}

/**
 * "¿No es alguno de estos?" — el paso que evita el duplicado.
 *
 * Tres reglas que NO son cosméticas:
 *
 * 1. **Con cero candidatos no se muestra**, y llama a `onSkip`. Preguntarle a
 *    alguien por una lista vacía es hacerle perder un paso.
 *
 * 2. **Si la consulta FALLA, sí se muestra**, con el cartel de error y
 *    "Publicar igual". Saltear en silencio pintaría "no hay candidatos" cuando
 *    en realidad no pudimos preguntar —el bug que `ListState` existe para
 *    matar— y acá el precio de esa mentira es el duplicado que este paso viene
 *    a evitar.
 *
 * 3. **Nunca bloquea.** Un 500 no puede impedir que alguien publique un animal
 *    que está en la calle ahora.
 */
export function CandidatesStep({ query, onSelect, onSkip, isPublishing }: CandidatesStepProps) {
  const { t, i18n } = useTranslation(['publish', 'common']);

  // `query.data` y no `items.length`: una lista vacía que SÍ llegó es una
  // respuesta ("no hay ninguno cerca") y el paso sobra. Un error deja `data`
  // en undefined y NO tiene que saltear.
  const sinCandidatos = query.data != null && query.data.length === 0;

  // El salteo automático corre UNA sola vez, y el ref es lo que lo garantiza.
  //
  // No es defensa contra un caso raro: `onSkip` sale sin memoizar del wizard, o
  // sea que cambia de identidad en CADA render, y publicar es asíncrono — entre
  // la llamada y el cambio de paso el wizard re-renderiza al menos una vez
  // (`isPending` del mutation). Con `onSkip` en las dependencias, el efecto
  // volvería a dispararse y crearía una SEGUNDA mascota: el duplicado exacto
  // que este paso existe para evitar. Sacar `onSkip` de las deps a secas no
  // alcanza —`sinCandidatos` sigue ahí y basta con que el padre remonte—, y
  // memoizarlo del lado del wizard delega el invariante en que alguien se
  // acuerde de envolver la función (el modo de falla de la regla #40).
  const yaSalteo = useRef(false);

  useEffect(() => {
    if (!sinCandidatos || yaSalteo.current) return;
    yaSalteo.current = true;
    onSkip();
  }, [sinCandidatos, onSkip]);

  if (sinCandidatos) return null;

  // "hace 4 meses" en el idioma del usuario. Se calcula en días y se deja que
  // Intl elija la unidad: 120 días es "hace 4 meses" y no "hace 120 días".
  const cuandoSeLoVio = (iso: string): string => {
    const dias = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
    // `|| undefined` y no `i18n.language` pelado: con un string vacío
    // `Intl.RelativeTimeFormat` tira RangeError, y como esto corre en el cuerpo
    // del render, una excepción acá deja EN BLANCO el paso que evita
    // duplicados. `undefined` cae al locale del navegador, que siempre existe.
    const fmt = new Intl.RelativeTimeFormat(i18n.language || undefined, { numeric: 'auto' });
    if (Math.abs(dias) >= 30) return fmt.format(-Math.round(dias / 30), 'month');
    return fmt.format(-dias, 'day');
  };

  return (
    <div data-testid="candidates-step">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        {t('publish:candidates.title')}
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        {t('publish:candidates.subtitle')}
      </p>

      <ListState
        query={query}
        loading={<div className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}
        // Inalcanzable: con cero candidatos el componente ya devolvió null. El
        // slot es obligatorio, así que va un fragmento vacío — que además es la
        // forma que `dibujaAlgo` reconoce para no dejar la franja huérfana.
        empty={<></>}
        errorTitle={t('publish:candidates.errorTitle')}
        errorBody={t('publish:candidates.errorBody')}
      >
        {(items) => (
          <ul className="space-y-3">
            {items.map((c) => (
              <li
                key={c.id}
                data-testid="candidate-card"
                data-pet-id={c.id}
                className="flex items-center gap-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3"
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                  {c.photo_url ? (
                    <img
                      // `cloudinaryThumb` (c_lfill, recorta) y no `cloudinaryFit`:
                      // la caja es `object-cover`. 128 es 2x los 64px CSS, la
                      // convención medida del resto de las miniaturas.
                      src={cloudinaryThumb(c.photo_url, 128)}
                      loading="lazy"
                      alt={c.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <PawPlaceholder className="w-1/2" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-gray-900 dark:text-gray-100">{c.name}</p>
                  {/* La fecha, NUNCA la palabra "vencido": es jerga nuestra,
                      sugiere que el animal ya no está, y lo que la persona
                      necesita para reconocerlo es cuándo se lo vio.
                      Y dice "por acá": el reloj es la última vista DENTRO del
                      radio consultado, no la última vista en cualquier lado. */}
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('publish:candidates.lastSeen', { when: cuandoSeLoVio(c.last_seen_nearby_at) })}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {t('publish:candidates.distance', { meters: Math.round(c.distance_meters) })}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="candidate-select"
                  onClick={() => onSelect(c)}
                  className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
                >
                  {t('publish:candidates.isThisOne')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </ListState>

      {/* Fuera del ListState a propósito: tiene que estar TAMBIÉN cuando la
          consulta falló, que es justo cuando el usuario no puede ver ninguna
          tarjeta y necesita una salida. */}
      <button
        type="button"
        data-testid="candidates-skip"
        onClick={onSkip}
        disabled={isPublishing}
        className="mt-6 w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {/* El texto sigue a lo que el usuario TIENE DELANTE, y son TRES
            estados, no dos. Sin datos no vio ninguna tarjeta, así que "ninguno
            de estos" no se refiere a nada — pero "publicar igual" tampoco vale
            mientras la consulta sigue en vuelo: afirma que ya miró y descartó,
            cuando lo que pasa es que todavía no llegaron. Con `data == null` a
            secas los dos son indistinguibles, porque en los dos `data` es
            undefined.

            El botón NO se deshabilita durante la carga, y es deliberado: este
            paso nunca bloquea a alguien apurado con un animal en la calle. Lo
            que cambia es que deje de mentir sobre por qué está ahí.

            `isLoading` y NUNCA `isPending`: en React Query v5 una query con
            `enabled: false` queda en `pending` para siempre, y ésta está
            gateada por el paso (regla #60). */}
        {query.isLoading
          ? t('publish:candidates.publishWithoutWaiting')
          : query.data == null
            ? t('publish:candidates.publishAnyway')
            : t('publish:candidates.noneOfThem')}
      </button>
    </div>
  );
}
