// ============================================================
// SearchPet — miniaturas de Cloudinary (shared)
// ============================================================

/**
 * Devuelve la URL de una foto pedida al tamaño de una miniatura.
 *
 * POR QUÉ EXISTE: el cuello de botella del plan gratuito de Cloudinary es el
 * BANDWIDTH, no el storage. El mapa puede dibujar decenas de marcadores a la
 * vez, y cada uno con la foto original de ~200 KB serían varios megas por
 * pantalla — el mismo pico viral que quema créditos.
 *
 * `g_auto` no es adorno: un `c_fill` sin gravity recorta al centro geométrico,
 * y en una foto vertical de un perro el centro suele ser el lomo. El marcador
 * mostraría pelo en vez de una cara.
 *
 * `height` existe porque no todo consumidor es cuadrado. Las tarjetas del feed
 * dibujan un contenedor de ~389x192 (2:1) y encima aplican `object-cover`: al
 * pedir un cuadrado, Cloudinary recorta una vez con `g_auto` y el navegador
 * recorta de nuevo arriba y abajo, ignorando la gravity. Ese segundo recorte es
 * el que corta cabezas, y además se pagan píxeles que nunca se muestran. Por
 * defecto es cuadrado, que es lo que necesita un marcador o un avatar.
 *
 * NO lleva `f_auto,q_auto`: el backend ya sube webp con `q_80` (ver
 * `pkg/storage/cloudinary.go`), así que volver a codificar AGRANDA el archivo.
 * Medido sobre una foto real de producción: 600x300 pesa 29.214 B tal cual y
 * 32.169 B agregándolos.
 *
 * Sólo toca URLs de Cloudinary que todavía no traen transformación. Cualquier
 * otra cosa vuelve intacta: mangling una URL ajena rompe la imagen en vez de
 * optimizarla, y encadenar dos transformaciones degrada la foto en silencio.
 */
export function cloudinaryThumb(
  url: string | undefined | null,
  size: number,
  height: number = size,
): string {
  if (!url) return '';

  const marca = '/image/upload/';
  const corte = url.indexOf(marca);
  if (corte === -1) return url;

  const resto = url.slice(corte + marca.length);

  // El backend guarda la URL con la versión (`v1786328704`) justo después de
  // /upload/. Si ahí hay otra cosa, ya hay una transformación puesta y no se
  // toca: es la única forma barata de distinguirlas sin parsear la gramática
  // entera de Cloudinary.
  if (!/^v\d+\//.test(resto)) return url;

  return `${url.slice(0, corte + marca.length)}w_${size},h_${height},c_fill,g_auto/${resto}`;
}

/**
 * Ancho y alto de la foto en una tarjeta de listado.
 *
 * Las tarjetas dibujan la foto en un contenedor `h-48` a ancho completo. Con la
 * grilla de 3 columnas dentro de `max-w-7xl` cada tarjeta mide ~389 px, así que
 * 600 da ~1,5x de densidad: nítido en pantallas retina sin pagar de más.
 *
 * Por qué 600 y no 800: medido sobre una foto real de producción, 600x300 pesa
 * 29.214 B y 800x400 pesa 53.724 B. El original que se servía antes pesaba
 * 197.848 B. Subir a 800 cuesta 1,8x más bytes por una diferencia que a 389 px
 * de ancho no se ve.
 */
const CARD_W = 600;
const CARD_H = 300;

/**
 * Foto de una tarjeta de listado (feed, adopción, mis mascotas).
 *
 * Existe para que todas las tarjetas pidan EL MISMO tamaño. Repetir los números
 * en cada pantalla es cómo terminan divergiendo, y una tarjeta que pide otra
 * medida no se ve rota: se ve igual y gasta distinto, que es justo la clase de
 * derroche que este helper vino a cerrar.
 */
export function cloudinaryCardThumb(url: string | undefined | null): string {
  return cloudinaryThumb(url, CARD_W, CARD_H);
}
