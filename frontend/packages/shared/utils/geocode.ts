// ============================================================
// SearchPet — geocodificación con Nominatim (OpenStreetMap)
// ============================================================

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/** Cuántos candidatos se le ofrecen al usuario para desambiguar. */
const LIMIT = 5;

/**
 * Medio lado del recuadro de preferencia, en grados (~333 km).
 *
 * NO es el área visible del mapa, y esa fue la sorpresa. Medido contra
 * Nominatim con la consulta "colonia" y el mapa en Montevideo:
 *
 *   ±0.05° (~5 km, lo que se ve a zoom 13)  → 1º Colonia, ALEMANIA
 *   ±0.5°  (~55 km)                         → 1º Colonia, ALEMANIA
 *   ±3°    (~333 km)                        → 1º Colonia del Sacramento ✅
 *
 * O sea que la implementación intuitiva —pasar los límites visibles del mapa—
 * no arregla nada: Köln le gana igual. El recuadro tiene que modelar "la región
 * donde está el usuario", no "lo que tiene en pantalla", porque el destino
 * típico de esta búsqueda está fuera de la vista actual (Colonia está a 180 km
 * de Montevideo).
 *
 * Y que a ±55 km todavía pierda es el motivo por el que esto NO alcanza solo:
 * el sesgo es frágil, así que la desambiguación real la hace el usuario
 * eligiendo de la lista. Esto sólo ordena bien esa lista.
 */
const REGION_SPAN_DEG = 3;

/** Un candidato. `label` es el `display_name` completo de Nominatim. */
export interface GeocodePlace {
  lat: number;
  lng: number;
  label: string;
}

/**
 * Los cuatro desenlaces son EXPLÍCITOS en el tipo a propósito.
 *
 * "No encontré nada" y "no pude preguntar" son cosas distintas para el usuario:
 * una le dice que reescriba, la otra que reintente. Colapsarlas en `null` deja
 * un no-op silencioso, que es exactamente como se ve una app rota.
 */
export type GeocodeResult =
  /** Uno o más candidatos, ya ordenados por Nominatim con el sesgo aplicado. */
  | { kind: 'ok'; places: GeocodePlace[] }
  | { kind: 'empty' }
  | { kind: 'error' }
  /**
   * Lo cancelamos NOSOTROS porque hay una búsqueda más nueva. No es un fallo y
   * no se le muestra nada al usuario: colapsarlo en `error` le diría
   * "revisá tu conexión" a alguien cuya conexión está perfecta, cada vez que
   * busca dos veces seguidas rápido.
   */
  | { kind: 'aborted' };

interface GeocodeOptions {
  language?: string;
  signal?: AbortSignal;
  /**
   * Dónde está mirando el usuario. Sólo PREFIERE lo cercano; no restringe, así
   * que no se pasa `bounded=1`.
   *
   * Ojo con lo que eso significa de verdad: medido, el sesgo es tan fuerte que
   * con el mapa en Uruguay buscar "madrid" devuelve una calle de Buenos Aires
   * y no Madrid, España — con `bounded` y sin `bounded`, idéntico. No es "podés
   * buscar cualquier cosa igual". Lo que lo salva es que el recuadro SIGUE al
   * mapa: si paneás a Europa, la preferencia se muda con vos.
   */
  near?: { lat: number; lng: number };
}

/**
 * Traduce un texto libre ("Pocitos") a una lista de candidatos.
 *
 * DEVUELVE VARIOS A PROPÓSITO. Con `limit=1` nos quedábamos con el primero del
 * ranking GLOBAL, y "Colonia" resuelve a Köln, Alemania — un usuario buscando a
 * su mascota terminaba a 11.000 km. Ningún sesgo elimina la ambigüedad: la
 * elige el usuario, que es quien sabe a cuál se refería. Es el mismo criterio
 * que el resto de esta pantalla, donde un filtro desconocido devuelve 400 en
 * vez de descartarse en silencio.
 *
 * SOBRE LA POLÍTICA DE USO DE NOMINATIM: pide identificar al llamador y no
 * pasar de 1 request por segundo. Lo primero, desde un browser, lo cumple el
 * `Referer` que el navegador manda SOLO — `User-Agent` es un header prohibido
 * por la especificación de fetch y setearlo no hace nada. Lo segundo lo cumple
 * el llamador: esto se dispara con Enter, nunca por tecla.
 */
export async function geocode(query: string, opts: GeocodeOptions = {}): Promise<GeocodeResult> {
  const q = query.trim();
  // Una consulta vacía no le pega a la red: sería gastar el presupuesto de
  // requests de la política en una pregunta sin contenido.
  if (!q) return { kind: 'empty' };

  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: String(LIMIT),
    'accept-language': opts.language ?? 'es',
  });

  if (opts.near) {
    const { lat, lng } = opts.near;
    const d = REGION_SPAN_DEG;
    // Nominatim espera <oeste>,<norte>,<este>,<sur>.
    params.set('viewbox', `${lng - d},${lat + d},${lng + d},${lat - d}`);
  }

  try {
    const resp = await fetch(`${ENDPOINT}?${params.toString()}`, { signal: opts.signal });
    // Un 429 con cuerpo vacío NO significa "no encontré nada".
    if (!resp.ok) return { kind: 'error' };

    const data = (await resp.json()) as { lat?: string; lon?: string; display_name?: string }[];
    if (!Array.isArray(data) || data.length === 0) return { kind: 'empty' };

    const places: GeocodePlace[] = [];
    for (const it of data) {
      const lat = Number(it.lat);
      const lng = Number(it.lon);
      // Se descarta el candidato SUELTO, no la respuesta entera: que uno venga
      // roto no es motivo para tirar los otros cuatro. Mover el mapa a NaN,NaN
      // lo deja en blanco sin un solo error visible.
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      places.push({ lat, lng, label: it.display_name ?? q });
    }

    // Vino respuesta pero ninguna usable: eso NO es "no encontré nada", es que
    // no pudimos entenderla.
    if (places.length === 0) return { kind: 'error' };

    return { kind: 'ok', places };
  } catch (e) {
    // La cancelación entra por acá: `fetch` rechaza con AbortError. Se mira el
    // signal primero porque es la fuente de verdad — el nombre del error
    // depende del runtime, y en algunos entornos de test es un DOMException
    // sintético.
    if (opts.signal?.aborted || (e as Error | undefined)?.name === 'AbortError') {
      return { kind: 'aborted' };
    }
    return { kind: 'error' };
  }
}
