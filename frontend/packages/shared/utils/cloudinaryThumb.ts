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
 * Ancho y alto de la foto en una tarjeta del feed.
 *
 * 600x300 es la proporción del contenedor en la grilla MÁS DENSA (`lg`, 3
 * columnas dentro de `max-w-7xl`): ~389x192, casi 2:1. En los otros
 * breakpoints NO coincide — a 768px la tarjeta es ~356x192 (1,85:1) y en una
 * sola columna llega a ~607x192 (3,16:1). O sea que `object-cover` sigue
 * recortando en tablet y en teléfonos grandes: pedir 600x300 ACHICA ese segundo
 * recorte, no lo elimina. Se elige el breakpoint más denso porque es el que más
 * fotos dibuja por pantalla.
 *
 * Sobre la nitidez, sin adornar: a ~389 px de ancho, 600 da 1,54x — por debajo
 * de 2x, así que en un teléfono con DPR 3 la foto se ve más blanda que antes de
 * este cambio, cuando se servía el original de 1200. Es un canje deliberado:
 * el cuello del plan gratuito es el bandwidth, no la resolución. Si algún día
 * molesta, la salida es un `srcSet` con un candidato 2x (`w_1200,h_600`), que
 * deja a los equipos 1x pagando lo mismo que hoy.
 *
 * Por qué 600 y no 800: medido sobre una foto real de producción, 600x300 pesa
 * 29.214 B y 800x400 pesa 53.724 B. Subir a 800 cuesta 1,8x más bytes.
 */
const CARD_W = 600;
const CARD_H = 300;

/**
 * Foto de una tarjeta del feed (`HomePage`, sus dos grillas).
 *
 * Existe para que las dos grillas pidan EL MISMO tamaño: una tarjeta que pide
 * otra medida no se ve rota, se ve igual y gasta distinto, que es justo la
 * clase de derroche que este helper vino a cerrar.
 *
 * OJO, hoy lo usa SÓLO el feed. `AdoptPage` y `MyPetsPage` siguen sirviendo la
 * foto entera, y cuando se conviertan no alcanza con llamar a esta función:
 * `AdoptPage` es `xl:grid-cols-4` (~283x192, 1,47:1) y `MyPetsPage` usa `h-40`,
 * así que 600x300 no es la medida de ninguna de las dos. Cada una necesita su
 * propia constante o esto vuelve a ser el problema que cierra.
 */
export function cloudinaryCardThumb(url: string | undefined | null): string {
  return cloudinaryThumb(url, CARD_W, CARD_H);
}
