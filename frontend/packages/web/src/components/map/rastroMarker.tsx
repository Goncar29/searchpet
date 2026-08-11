import L from 'leaflet';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';

// ============================================================
// SearchPet — el marcador del mapa ES el logo Rastro
// ============================================================
//
// LA GEOMETRÍA ES LA DEL LOGO, TAL CUAL. Está copiada de `Logo.tsx` sin tocar
// un solo número: las tres huellas, el `translate/scale` de la pata, la elipse
// de la almohadilla y los cuatro dedos. Lo único que se agrega es la foto de la
// mascota RECORTADA contra esa misma elipse.
//
// La versión anterior usaba "proporciones ajustadas al marcador" —el rastro se
// achicaba, la pata crecía, y la almohadilla elíptica se reemplazaba por un div
// circular de 30×30—, con el argumento de que a tamaño de pin la almohadilla
// nativa queda chica. El resultado era un logo deformado: una marca de 122×72
// (ANCHA) metida a la fuerza en una caja de 56×64 (ALTA). Se veía estirada
// porque estaba estirada.
//
// La tensión era real, pero se resolvió del lado equivocado. Si la almohadilla
// nativa es el 32% del ancho, la respuesta es agrandar el MARCADOR hasta que
// esa fracción alcance, no deformar la marca. De ahí los 88×52: respetan el
// aspecto del logo al milímetro y dejan una almohadilla de ~28×23 px, que es el
// mismo tamaño de foto que tenía el marcador deformado.

/** El `viewBox` recortado de `Logo.tsx` (`tight`). Su aspecto es 122×72. */
const VIEW_BOX = '6 38 122 72';
const VB = { x: 6, y: 38, w: 122, h: 72 };

/**
 * Caja del marcador en píxeles. **Respeta el aspecto del logo**: 88/52 = 1.69,
 * igual que 122/72. Si cambiás uno, calculá el otro — descuadrarlos es
 * exactamente el defecto que esto vino a arreglar.
 */
export const MARKER_SIZE: [number, number] = [88, 52];

/** Las dos transformaciones del logo, compuestas: translate(4,20) ∘ translate(44.65,6.86). */
const PAW_TRANSFORM = 'translate(48.65,26.86) scale(0.85)';

/** La almohadilla en coordenadas internas del logo — la elipse que lleva la foto. */
const PAD = { cx: 51, cy: 64, rx: 23, ry: 19 };

/**
 * La almohadilla ya proyectada a la raíz del `viewBox`, para ubicar la `<image>`.
 * Sale de aplicarle PAW_TRANSFORM a PAD: 48.65 + 0.85·51 = 92, etc.
 */
const PAD_ROOT = { cx: 92, cy: 81.26, rx: 19.55, ry: 16.15 };

const px = (vx: number, vy: number): [number, number] => [
  ((vx - VB.x) / VB.w) * MARKER_SIZE[0],
  ((vy - VB.y) / VB.h) * MARKER_SIZE[1],
];

/**
 * El ancla es la huella CHICA de la izquierda — `circle(10,82)` del logo, que
 * en la raíz cae en (14,102). Esa punta es la que toca la coordenada real: con
 * el ancla en el centro, el pin marcaría un lugar que no es donde se vio a la
 * mascota.
 */
export const MARKER_ANCHOR: [number, number] = px(14, 102).map(Math.round) as [number, number];

/** El popup abre arriba de la almohadilla, no encima del ancla. */
const [padCx, padTop] = px(PAD_ROOT.cx, PAD_ROOT.cy - PAD_ROOT.ry);
export const MARKER_POPUP_ANCHOR: [number, number] = [
  Math.round(padCx - MARKER_ANCHOR[0]),
  Math.round(padTop - MARKER_ANCHOR[1]),
];

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

/**
 * Id único por marcador para el `clipPath`.
 *
 * Los ids de SVG son GLOBALES al documento y el mapa dibuja decenas de pines a
 * la vez. Con un id compartido, sacar un marcador del DOM se llevaría puesta la
 * definición que los otros siguen referenciando.
 */
function idClip(semilla: string): string {
  let h = 5381;
  for (let i = 0; i < semilla.length; i++) h = ((h << 5) + h + semilla.charCodeAt(i)) | 0;
  return `rastro-pad-${(h >>> 0).toString(36)}`;
}

export function rastroMarkerHtml(
  status: string,
  photoUrl: string | undefined,
  petName: string,
): string {
  const color = TOKEN_POR_ESTADO[status] ?? 'var(--color-lost)';
  const nombre = escaparHtml(petName);
  const thumb = cloudinaryThumb(photoUrl, 64);
  const clip = idClip(`${status}|${thumb}|${petName}`);

  // Sin foto NO se dibuja nada extra: queda el logo tal cual, sólido en el color
  // del estado — que es, en esencia, el marcador de siempre. Un hueco blanco se
  // leería como un error.
  //
  // `slice` y no `meet`: la foto CUBRE la elipse y se recorta. Con `meet`
  // entraría entera y se deformaría para llenar una caja que no es cuadrada,
  // que es el mismo error que este archivo vino a corregir, un nivel más abajo.
  const foto = thumb
    ? `<image href="${escaparHtml(thumb)}" x="${PAD_ROOT.cx - PAD_ROOT.rx}" y="${PAD_ROOT.cy - PAD_ROOT.ry}" width="${PAD_ROOT.rx * 2}" height="${PAD_ROOT.ry * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})" />
    <ellipse cx="${PAD_ROOT.cx}" cy="${PAD_ROOT.cy}" rx="${PAD_ROOT.rx}" ry="${PAD_ROOT.ry}" fill="none" stroke="${color}" stroke-width="3" />`
    : '';

  return `<svg class="rastro-pin" width="${MARKER_SIZE[0]}" height="${MARKER_SIZE[1]}" viewBox="${VIEW_BOX}" role="img" style="overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">
  <title>${nombre}</title>
  <defs>
    <clipPath id="${clip}">
      <ellipse cx="${PAD.cx}" cy="${PAD.cy}" rx="${PAD.rx}" ry="${PAD.ry}" transform="${PAW_TRANSFORM}" />
    </clipPath>
  </defs>
  <g fill="${color}" transform="translate(4,20)">
    <circle class="huella" cx="10" cy="82" r="4" />
    <circle class="huella" cx="28" cy="72" r="5.5" />
    <circle class="huella" cx="47" cy="61" r="7" />
    <g transform="translate(44.65,6.86) scale(0.85)">
      <ellipse cx="${PAD.cx}" cy="${PAD.cy}" rx="${PAD.rx}" ry="${PAD.ry}" />
      <circle class="dedo" cx="23" cy="43" r="9.5" />
      <circle class="dedo" cx="41" cy="28" r="10.5" />
      <circle class="dedo" cx="61" cy="28" r="10.5" />
      <circle class="dedo" cx="79" cy="43" r="9.5" />
    </g>
  </g>
  ${foto}
</svg>`;
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
