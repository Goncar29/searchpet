/**
 * Radio, en METROS, que la capa de veterinarias le pide a la API.
 *
 * Existe como funcion compartida y no como expresion inline porque el defecto
 * original fue exactamente eso: web y mobile escribian la regla por separado y
 * las dos tenian el valor 5000 hardcodeado, ignorando el selector de radio del
 * mapa. Con el radio en 10 km los reportes se estiraban y las veterinarias no.
 *
 * La regla tiene DOS mitades y ninguna sobra:
 *
 * 1. Sigue al selector cuando el usuario abre el radio. Si pide 10 km, quiere
 *    ver veterinarias de 10 km.
 * 2. Nunca baja del piso. Con el radio por defecto en 3 km, seguir al selector
 *    al pie de la letra mostraria MENOS veterinarias que antes de arreglar el
 *    bug (45 contra las 50 que se dibujaban), y el sintoma que se estaba
 *    arreglando era justamente "faltan veterinarias". El piso lo impide: por
 *    defecto se ven las 69 que hay dentro de 5 km del centro de Montevideo.
 *
 * La contra, asumida a conciencia: con el radio en 1 km se dibujan veterinarias
 * fuera del circulo de busqueda. Es deliberado — el circulo acota donde se
 * buscan REPORTES, mientras que las veterinarias son una capa de contexto
 * ("donde puedo llevar a este animal"), y ahi de mas siempre es mejor que de
 * menos.
 */
export const VET_LAYER_MIN_RADIUS_METERS = 5000;

export function vetLayerRadiusMeters(radiusKm: number): number {
  const requested = radiusKm * 1000;
  return requested > VET_LAYER_MIN_RADIUS_METERS ? requested : VET_LAYER_MIN_RADIUS_METERS;
}
