// ============================================================
// SearchPet — tamaños de imagen que se le piden a Cloudinary (mobile)
// ============================================================

/**
 * Qué tamaño pedirle a Cloudinary por cada tipo de imagen de la app nativa.
 *
 * POR QUÉ EXISTE, y por qué en mobile el cálculo NO es el de la web: el backend
 * sube todo con `w_1200,c_limit`, así que cada `<Image>` que pinta la URL cruda
 * baja ~107 KB. En una lista de miembros de un grupo, veinte avatares de 44 dp
 * son 2,1 MB para dibujar círculos de 44 puntos.
 *
 * El límite del plan gratuito de Cloudinary son 25 créditos/mes y 1 crédito es
 * 1 GB de bandwidth, de un pool compartido con la web. O sea que esto no es
 * cosmético: es techo de tráfico del proyecto entero.
 *
 * CÓMO SE ELIGEN LOS NÚMEROS. En React Native las medidas son dp, no píxeles:
 * hay que multiplicar por el DPR del dispositivo. Se toma **3x**, que es el de
 * un teléfono moderno típico (390 dp de ancho a 3x = 1170 px físicos); a 2x
 * sobra y a 3x alcanza justo.
 *
 * Los de ancho completo se piden a 1200 de ANCHO a propósito, o sea sin
 * achicar: a 3x un teléfono necesita ~1170 px y bajar de ahí se ve blando. Lo
 * que ahorra en esos casos es el ALTO — la foto original es 3:4 vertical y la
 * caja es apaisada, así que el recorte tira la mayor parte. Medido sobre una
 * foto real de producción (107.156 B el original):
 *
 *   w_96,h_96      1.996 B     w_1200,h_540    42.840 B
 *   w_128,h_128    2.598 B     w_1200,h_900    56.518 B
 *   w_192,h_192    5.026 B
 *
 * Todos los consumidores usan `resizeMode: 'cover'` (y el default de RN también
 * es `cover`), así que recortar con `c_lfill` es correcto en los trece. Ojo que
 * esto NO vale para la web: `PetDetailPage` es `object-contain` y ahí recortar
 * cortaría la cabeza de una foto vertical.
 */
export const IMAGE_SIZES = {
  /** Cajas de 36-44 dp: avatar de reseña, miembro de grupo. */
  avatarSm: 96,
  /** Cajas de 56 dp: miniatura del wizard, resultado de búsqueda por foto. */
  thumb: 128,
  /** Cajas de 72 dp: la fila de "Mis mascotas". */
  thumbLg: 160,
  /** Cajas de 80-88 dp: avatar del perfil propio y del público, foto de acogida. */
  avatarMd: 192,
} as const;

/**
 * Los de ancho completo, como par `[ancho, alto]`.
 *
 * El alto sale de la caja en dp por 3. Si alguien cambia la altura del
 * contenedor, hay que cambiar el número acá — una imagen pedida a la medida
 * equivocada no se ve rota: se ve igual y gasta distinto.
 */
export const IMAGE_BOXES = {
  /** Cards de 140-180 dp de alto: PetCard, refugios, historias. */
  card: [1200, 540],
  /** Carrusel de casa de acogida: 260 dp. */
  carousel: [1200, 780],
  /** Carrusel del detalle de mascota: 300 dp. */
  carouselTall: [1200, 900],
} as const;
