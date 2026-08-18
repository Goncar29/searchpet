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
 * dibujan un contenedor de ~389x192 y encima aplican `object-cover`: al pedir
 * un cuadrado, Cloudinary recorta una vez con `g_auto` y el navegador recorta
 * de nuevo arriba y abajo, ignorando la gravity. Ese segundo recorte es el que
 * corta cabezas, y además se pagan píxeles que nunca se muestran. Por defecto
 * es cuadrado, que es lo que necesita un marcador o un avatar.
 *
 * `c_lfill` y NO `c_fill`, que es la trampa de este helper: `c_fill` AGRANDA
 * cuando la fuente es más chica que lo pedido. El backend sube con
 * `w_1200,c_limit` (`pkg/storage/cloudinary.go`) y `c_limit` nunca agranda, así
 * que un asset guardado puede medir menos de 600px de ancho — una captura de
 * pantalla, una foto reenviada por WhatsApp. Medido encadenando sobre una foto
 * real achicada a 320px: la fuente pesa 10.062 B, `c_fill` devuelve 11.346 B
 * (MÁS que el original, o sea lo contrario de para lo que existe este helper) y
 * `c_lfill` devuelve 9.038 B. Con fuentes grandes los dos dan idéntico —
 * verificado, 15.430 B los dos sobre un asset de 1200x1600— así que el cambio
 * no le mueve nada a los llamadores del mapa.
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

  return `${url.slice(0, corte + marca.length)}w_${size},h_${height},c_lfill,g_auto/${resto}`;
}

/**
 * Medidas de la foto en cada listado, en un solo lugar.
 *
 * CÓMO SE ELIGE CADA UNA, porque no es a ojo: se toma el contenedor en la
 * grilla MÁS DENSA de esa pantalla (la que más fotos dibuja por vista) sobre el
 * ancho de contenido real, que son 1216 px dentro de `max-w-7xl`, y se pide esa
 * proporción con ~1,5x de densidad.
 *
 *   variante   pantalla      grilla densa                          caja      proporción
 *   feed       HomePage      lg:3 gap-6                            389x192   2,03:1
 *   adopt      AdoptPage     xl:4 gap-6                            286x192   1,49:1
 *   compact    MyPetsPage    lg:3 gap-4                            395x160   2,47:1
 *   compact    ProfilePage   sm:2 gap-6 dentro de lg:col-span-2    388x160   2,43:1
 *
 * OJO con la última fila: `ProfilePage` NO tiene la grilla de `MyPetsPage`. La
 * suya es `sm:grid-cols-2 gap-6` anidada en el `lg:col-span-2` de un layout
 * `lg:grid-cols-3 gap-8`, así que su caja se deriva distinto y da 388x160.
 * Comparten variante porque 2,43 y 2,47 son la misma medida a los fines
 * prácticos, NO porque compartan grilla: quien vaya a recalcular el número del
 * perfil tiene que medir el perfil, no copiar las columnas de MyPetsPage.
 *
 * `adopt` es casi cuadrada porque esa pantalla llega a CUATRO columnas, y
 * `compact` es más apaisada porque su caja es `h-40` en vez de `h-48`. Por eso
 * NO comparten medida con el feed: una sola constante para las tres se vería
 * bien igual y recortaría distinto en cada una.
 *
 * DOS COSAS QUE ESTAS MEDIDAS **NO** HACEN, para que nadie lea de más:
 *
 * 1. No eliminan el recorte del navegador, lo achican. La proporción sólo
 *    coincide en el breakpoint denso; en una sola columna la caja del feed
 *    llega a 3,16:1 y `object-cover` recorta igual.
 * 2. No son 2x. A ~389 px de ancho, 600 da 1,54x, así que en un teléfono con
 *    DPR 3 la foto se ve más blanda que sirviendo el original. Es deliberado:
 *    el cuello del plan gratuito es el bandwidth, no la resolución. La salida,
 *    si algún día molesta, es un `srcSet` con candidato 2x.
 *
 * Por qué ~1,5x y no 2x: medido sobre una foto real de producción, 600x300 pesa
 * 29.214 B y 800x400 pesa 53.724 B. Subir a 800 cuesta 1,8x más bytes.
 */
const LISTING_SIZES = {
  feed: [600, 300],
  adopt: [450, 300],
  compact: [600, 240],
} as const;

export type ListingVariant = keyof typeof LISTING_SIZES;

/**
 * Foto de una tarjeta de listado, por variante.
 *
 * Existe para que ninguna pantalla escriba sus propios números: una tarjeta que
 * pide otra medida no se ve rota, se ve igual y gasta distinto, que es justo la
 * clase de derroche que este helper vino a cerrar. Agregar un listado nuevo es
 * medir su grilla densa y sumar una variante acá, no copiar la de al lado.
 */
export function cloudinaryCardThumb(
  url: string | undefined | null,
  variant: ListingVariant = 'feed',
): string {
  const [w, h] = LISTING_SIZES[variant];
  return cloudinaryThumb(url, w, h);
}
