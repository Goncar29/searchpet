/**
 * Decimales con los que se guarda una coordenada elegida en el mapa.
 *
 * Seis decimales de grado son ~11 cm en el ecuador. La alerta más chica que se
 * puede crear tiene un radio de 1 km, así que esto es cuatro órdenes de
 * magnitud más fino que la cosa que describe.
 *
 * El número importa por lo que EVITA, no por lo que permite: Leaflet devuelve
 * la latitud de un click con toda la precisión del `double`
 * (`-34.899025460930744`), y ese valor terminaba crudo dentro de un
 * `<input type="number">` que el usuario tiene que poder leer y corregir a
 * mano. Dieciséis dígitos no se leen, no se tipean y no significan nada.
 */
const DECIMALES = 6;

/** Recorta una coordenada a una precisión que una persona pueda leer. */
export function redondearCoordenada(valor: number): number {
  return Number(valor.toFixed(DECIMALES));
}
