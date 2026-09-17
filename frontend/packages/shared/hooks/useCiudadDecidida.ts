import { useCallback, useEffect, useRef } from 'react';

/**
 * Decide qué ciudad mira el ranking, para web y mobile a la vez.
 *
 * La lógica vivía duplicada en `LeaderboardPage.tsx` y en
 * `app/leaderboard/index.tsx`: el mismo ref, el mismo efecto y la misma guarda
 * de entrada vacía, escritos dos veces. Cada arreglo tenía que aterrizar en los
 * dos lados, y ya pasó que aterrizara en uno solo — el test del submit vacío
 * existe en web y nunca se escribió para mobile, que es donde el caso es MÁS
 * alcanzable porque el submit también cuelga de `onBlur`.
 *
 * ## El ref significa "YA ESTÁ DECIDIDA", no "ya sembré"
 *
 * Las dos capas de sesión hidratan asincrónicamente, así que la pantalla se
 * dibuja antes de que llegue el perfil. Con la pregunta equivocada pasaba esto:
 * alguien entra, tipea su ciudad y busca con la sesión todavía en vuelo; llega
 * el perfil y le pisa la búsqueda. Por eso buscar a mano DECIDE igual que
 * sembrar desde el perfil.
 *
 * ## Por qué un efecto y no el valor inicial de `useState`
 *
 * `useState(user?.city ?? '')` capturaría el valor del primer render —cuando
 * todavía no hay sesión— y no se enteraría nunca de que llegó. Y falla
 * VIÉNDOSE SANA: la pantalla queda igual que si la persona no tuviera ciudad.
 */
export interface CiudadDecididaOptions {
  /**
   * Id de la sesión actual. `null` mientras no hay sesión.
   *
   * No se usa para sembrar: se usa para saber cuándo la decisión anterior dejó
   * de ser de esta persona. Ver el efecto de identidad abajo.
   */
  userId?: string | null;

  /** Ciudad del perfil. Vacía o ausente mientras la sesión no hidrató. */
  ciudadDelPerfil?: string | null;

  /**
   * `true` cuando la sesión terminó de resolverse, haya usuario o no.
   *
   * Sin esto no se puede distinguir "todavía no sé tu ciudad" de "sé que no
   * tenés", y esa diferencia es justo la que decide si corresponde el
   * `fallback`.
   */
  sesionResuelta?: boolean;

  /**
   * Ciudad a mostrar cuando la sesión ya se resolvió y no hay ciudad propia.
   *
   * Mobile pasa el default del proyecto porque su pantalla no tiene estado
   * vacío; web NO pasa nada y sigue pidiendo la ciudad. Sin este parámetro
   * mobile tenía el default en el `useState` inicial, así que a alguien de
   * Salto le disparaba una consulta de Montevideo y se la rotulaba como propia
   * mientras la sesión viajaba.
   */
  fallback?: string;

  /** Aplica la ciudad en el estado de la pantalla. */
  aplicar: (ciudad: string) => void;
}

export interface CiudadDecidida {
  /**
   * Decide la ciudad a mano. Devuelve la ciudad ya recortada, o `null` si la
   * entrada estaba vacía.
   *
   * NO aplica por su cuenta: devuelve para que cada pantalla haga lo suyo (web
   * deja el borrador como lo tipeaste, mobile no tiene borrador). Lo que sí
   * centraliza es la guarda del vacío y la marca del ref, que es lo que estaba
   * duplicado.
   */
  decidirManualmente: (entrada: string) => string | null;
}

export function useCiudadDecidida({
  userId,
  ciudadDelPerfil,
  sesionResuelta,
  fallback,
  aplicar,
}: CiudadDecididaOptions): CiudadDecidida {
  const decidida = useRef(false);

  // `aplicar` se redefine en cada render. Guardarlo en un ref lo mantiene
  // fresco sin meterlo en las dependencias del efecto de siembra, que si no se
  // volvería a disparar en cada render. El efecto que lo refresca va PRIMERO
  // porque React corre los efectos en orden de declaración.
  const aplicarRef = useRef(aplicar);
  useEffect(() => {
    aplicarRef.current = aplicar;
  });

  /**
   * Cambio de identidad: la decisión anterior era de OTRA persona.
   *
   * Sin esto, A se desloguea, entra B y B ve el ranking de la ciudad de A
   * rotulado como propio — el mismo "plausible, silencioso y equivocado" que
   * este código vino a eliminar. En web no se notaba porque el logout hace
   * `navigate('/')` y la página se desmonta; en mobile la pantalla sobrevive.
   *
   * OJO CON LA CONDICIÓN, que es donde está el riesgo: sólo resetea cuando el
   * id ANTERIOR era real. La transición `null → alguien` es la hidratación
   * normal, NO un cambio de identidad, y resetear ahí reintroduciría
   * exactamente el defecto crítico que arregló el PR #248: quien buscó a mano
   * antes de que llegara la sesión perdería su búsqueda contra el perfil.
   */
  const idAnterior = useRef<string | null>(userId ?? null);
  useEffect(() => {
    const actual = userId ?? null;
    const anterior = idAnterior.current;
    idAnterior.current = actual;
    if (anterior !== null && anterior !== actual) {
      decidida.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (decidida.current) return;

    const propia = ciudadDelPerfil?.trim();
    if (propia) {
      decidida.current = true;
      aplicarRef.current(propia);
      return;
    }

    // Sin ciudad propia. Sólo se cae al `fallback` una vez que la sesión se
    // resolvió: antes de eso no sabemos si la persona tiene ciudad, y mostrar
    // el default ahí es el defecto que este hook vino a cerrar.
    if (!sesionResuelta || !fallback) return;

    // EL FALLBACK NO DECIDE NADA, y por eso NO toca el ref.
    //
    // Es lo que se muestra mientras tanto, no una elección. Marcarlo quemaba la
    // siembra: alguien sin sesión veía el default, se logueaba, y su ciudad ya
    // no entraba nunca porque la decisión estaba tomada. Lo mismo para una
    // cuenta sin ciudad —las anteriores a que fuera obligatoria en el alta— que
    // después la completa.
    //
    // Dejarlo sin marcar es seguro: los únicos que escriben son este efecto,
    // que sale arriba si la ciudad ya está decidida, y el submit manual, que sí
    // decide. Así que el default nunca puede pisar una elección real.
    aplicarRef.current(fallback);
  }, [ciudadDelPerfil, userId, sesionResuelta, fallback]);

  const decidirManualmente = useCallback((entrada: string): string | null => {
    const limpia = entrada.trim();
    // Un submit vacío no decide nada, y la guarda va ANTES de tocar el ref:
    // ninguno de los dos inputs es `required`, así que un Enter en el campo
    // vacío —o un `onBlur` en mobile, que alcanza con tocar afuera— llega hasta
    // acá. Marcar la ciudad como decidida ahí quemaría la siembra para siempre
    // y la pantalla quedaría pidiendo una ciudad que ya tenemos.
    if (!limpia) return null;
    decidida.current = true;
    return limpia;
  }, []);

  return { decidirManualmente };
}
