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

  // Cualquier acción manual en este paso consume el salteo automático, y se
  // marca ACÁ y no adentro del efecto: el efecto sólo ve el estado del render en
  // que corre, así que atarlo a `isPublishing` lo hacía depender del ORDEN en
  // que llegaran la respuesta de la consulta y el fallo de la publicación. En el
  // orden inverso —falla primero, contesta después— el ref seguía en false y
  // salía un segundo `onSkip()`. Una vez que la persona eligió —publicar igual,
  // o "es este"— ya no queda nada que saltear, pase lo que pase después.
  const consumirSalteo = () => {
    yaSalteo.current = true;
  };

  useEffect(() => {
    // `isPublishing` frena el salteo igual que frena el botón, y por el mismo
    // motivo: `onSkip` PUBLICA. El ref solo cubre el re-render, no el cambio de
    // respuesta. Quien toca la salida con la consulta en vuelo deja un alta
    // corriendo mientras `sinCandidatos` sigue en false; cuando la consulta
    // contesta `[]`, el flanco enciende el efecto con `yaSalteo` todavía en
    // false y sale un SEGUNDO alta.
    //
    // Mobile ya lo tenía desde el #230 y acá faltaba: las dos plataformas
    // divergieron en silencio durante dos PRs.
    // `isPublishing` sigue acá como red, pero NO es lo que sostiene la
    // corrección: el ref lo consume la acción manual (ver `consumirSalteo`).
    // Ponerlo sólo acá ataba el arreglo al ORDEN de dos eventos independientes
    // —que la consulta conteste y que la publicación falle— y en el orden
    // inverso (falla primero, contesta después) `yaSalteo` seguía en false y
    // salía un segundo `onSkip()`. Reproducido con 4 renders.
    if (!sinCandidatos || yaSalteo.current || isPublishing) return;
    yaSalteo.current = true;
    onSkip();
  }, [sinCandidatos, onSkip, isPublishing]);

  // Sin candidatos no hay nada que preguntar y el efecto ya llamó a `onSkip`:
  // devolver null evita el flash de una pantalla vacía mientras el wizard cambia
  // de paso.
  //
  // Esto estuvo relajado a `sinCandidatos && !yaSalteo.current` para que, si la
  // publicación fallaba, la salida siguiera en pantalla como reintento. Se
  // REVIRTIÓ: desocultaba el paso también en el camino automático —el más
  // común, porque la mayoría de los callejeros no tienen candidatos cerca— y
  // pintaba el encabezado con CERO tarjetas durante toda la publicación, que es
  // justo el flash que esta línea existe para evitar. Un arreglo que costaba
  // cuatro defectos para cerrar uno que ya tenía salida (volver al selector).
  //
  // Si el reintento tras un fallo importa, es del WIZARD: él tiene el error y el
  // estado. Este componente pregunta por candidatos y no debería estar
  // decidiendo nada sobre una publicación fallida.
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
                  onClick={() => {
                    consumirSalteo();
                    onSelect(c);
                  }}
                  disabled={isPublishing}
                  className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
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
        onClick={() => {
          consumirSalteo();
          onSkip();
        }}
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
        {query.isFetching && query.data == null
          ? t('publish:candidates.publishWithoutWaiting')
          : query.data == null
            ? t('publish:candidates.publishAnyway')
            : t('publish:candidates.noneOfThem')}
      </button>
    </div>
  );
}
