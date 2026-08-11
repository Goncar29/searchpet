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
 * Sólo toca URLs de Cloudinary que todavía no traen transformación. Cualquier
 * otra cosa vuelve intacta: mangling una URL ajena rompe la imagen en vez de
 * optimizarla, y encadenar dos transformaciones degrada la foto en silencio.
 */
export function cloudinaryThumb(url: string | undefined | null, size: number): string {
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

  return `${url.slice(0, corte + marca.length)}w_${size},h_${size},c_fill,g_auto/${resto}`;
}
