import L from 'leaflet';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';

// ============================================================
// SearchPet — el marcador del mapa es el logo Rastro
// ============================================================
//
// El logo es un rastro de tres huellas que crecen y desembocan en una pata.
// El marcador reusa esa construcción con PROPORCIONES AJUSTADAS: el rastro se
// achica y la pata crece, para que la almohadilla llegue a 30px y la foto de la
// mascota se reconozca. Con las proporciones nativas del logo la almohadilla es
// el 30% del ancho, o sea ~12px a tamaño de marcador — ahí no se distingue un
// gato de un perro y la foto no serviría para nada.
//
// El ANCLA es la huella chica de la izquierda: esa punta toca la coordenada
// real. Con el ancla en el centro, el pin marcaría un lugar que no es donde se
// vio a la mascota.
//
// El ESTADO se mudó al ANILLO. Antes vivía en el color del marcador entero;
// con la foto ocupando el centro, el anillo es lo que conserva ese significado.
// Lee los mismos tokens que la leyenda y los chips del panel.

/** Caja del marcador en píxeles: [ancho, alto]. */
export const MARKER_SIZE: [number, number] = [56, 64];

/** La huella chica de la izquierda — el punto que toca la coordenada. */
export const MARKER_ANCHOR: [number, number] = [6, 58];

/** El popup abre arriba de la pata, no encima del ancla. */
export const MARKER_POPUP_ANCHOR: [number, number] = [30, -34];

const TOKEN_POR_ESTADO: Record<string, string> = {
  lost: 'var(--color-lost)',
  found: 'var(--color-found)',
  sighting: 'var(--color-sighting)',
};

/** El icono se arma como CADENA de HTML, así que todo lo que venga de datos escapa. */
function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function rastroMarkerHtml(
  status: string,
  photoUrl: string | undefined,
  petName: string,
): string {
  const color = TOKEN_POR_ESTADO[status] ?? 'var(--color-lost)';
  const nombre = escaparHtml(petName);
  const thumb = cloudinaryThumb(photoUrl, 64);

  // Sin foto, la almohadilla va sólida en el color del estado — que es, en
  // esencia, el marcador de siempre. Un hueco blanco se leería como un error.
  const contenidoPad = thumb
    ? `<img src="${escaparHtml(thumb)}" alt="${nombre}" width="30" height="30" style="width:100%;height:100%;object-fit:cover;display:block" />`
    : '';

  return `<div class="rastro-pin" style="position:relative;width:56px;height:64px">
  <svg width="56" height="64" viewBox="0 0 56 64" style="position:absolute;inset:0" aria-hidden="true">
    <circle class="huella" cx="6" cy="58" r="2.5" fill="${color}"/>
    <circle class="huella" cx="13" cy="52" r="3" fill="${color}"/>
    <circle class="huella" cx="20" cy="46" r="3.5" fill="${color}"/>
    <circle class="dedo" cx="22" cy="14" r="5" fill="${color}"/>
    <circle class="dedo" cx="31" cy="7" r="5.5" fill="${color}"/>
    <circle class="dedo" cx="42" cy="7" r="5.5" fill="${color}"/>
    <circle class="dedo" cx="51" cy="14" r="5" fill="${color}"/>
  </svg>
  <div style="position:absolute;left:21px;top:22px;width:30px;height:30px;border-radius:50%;overflow:hidden;border:3px solid ${color};background:${color};box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.35)">${contenidoPad}</div>
</div>`;
}

/**
 * Marcador de veterinaria: una gota con la cruz médica, en el color secundario.
 *
 * Existe para terminar de sacar `raw.githubusercontent.com` del mapa. Ese
 * origen servía cuatro PNGs de colores desde un repo de terceros en la pantalla
 * más usada de la app: si ese repo se cae, se renombra o cambia de licencia,
 * los pines desaparecen. Y obligaba a sostenerlo en la CSP para nada.
 */
export function vetDivIcon() {
  return L.divIcon({
    html: `<svg width="28" height="38" viewBox="0 0 28 38" aria-hidden="true">
  <path d="M14 0C6.3 0 0 6.3 0 14c0 9.9 12.4 22.6 13 23.2.6.6 1.4.6 2 0 .6-.6 13-13.3 13-23.2C28 6.3 21.7 0 14 0z" fill="var(--color-secondary)"/>
  <circle cx="14" cy="14" r="8.5" fill="#fff"/>
  <path d="M12.2 8.6h3.6v3.6h3.6v3.6h-3.6v3.6h-3.6v-3.6H8.6v-3.6h3.6z" fill="var(--color-secondary)"/>
</svg>`,
    className: '',
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    popupAnchor: [0, -34],
  });
}

/** El divIcon que consume react-leaflet. */
export function rastroDivIcon(status: string, photoUrl: string | undefined, petName: string) {
  return L.divIcon({
    html: rastroMarkerHtml(status, photoUrl, petName),
    // Sin esto Leaflet mete su fondo y su borde por defecto alrededor del HTML.
    className: '',
    iconSize: MARKER_SIZE,
    iconAnchor: MARKER_ANCHOR,
    popupAnchor: MARKER_POPUP_ANCHOR,
  });
}
