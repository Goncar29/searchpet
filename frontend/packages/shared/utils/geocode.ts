// ============================================================
// SearchPet — geocodificación con Nominatim (OpenStreetMap)
// ============================================================

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * Los tres desenlaces son EXPLÍCITOS en el tipo a propósito.
 *
 * "No encontré nada" y "no pude preguntar" son cosas distintas para el usuario:
 * una le dice que reescriba, la otra que reintente. Colapsarlas en `null` deja
 * un no-op silencioso, que es exactamente como se ve una app rota.
 */
export type GeocodeResult =
  | { kind: 'ok'; lat: number; lng: number; label: string }
  | { kind: 'empty' }
  | { kind: 'error' };

interface GeocodeOptions {
  language?: string;
  signal?: AbortSignal;
}

/**
 * Traduce un texto libre ("Pocitos") a coordenadas.
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
    limit: '1',
    'accept-language': opts.language ?? 'es',
  });

  try {
    const resp = await fetch(`${ENDPOINT}?${params.toString()}`, { signal: opts.signal });
    // Un 429 con cuerpo vacío NO significa "no encontré nada".
    if (!resp.ok) return { kind: 'error' };

    const data = (await resp.json()) as { lat?: string; lon?: string; display_name?: string }[];
    if (!Array.isArray(data) || data.length === 0) return { kind: 'empty' };

    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    // Mover el mapa a NaN,NaN lo deja en blanco sin un solo error visible.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { kind: 'error' };

    return { kind: 'ok', lat, lng, label: data[0].display_name ?? q };
  } catch {
    return { kind: 'error' };
  }
}
