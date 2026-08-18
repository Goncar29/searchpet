import { describe, it, expect } from 'vitest';
import { cloudinaryThumb, cloudinaryCardThumb } from './cloudinaryThumb';

const REAL =
  'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1786328704/searchpet/pets/040f876a/foto.webp';

describe('cloudinaryThumb', () => {
  it('inserta la transformacion despues de /upload/', () => {
    expect(cloudinaryThumb(REAL, 64)).toBe(
      'https://res.cloudinary.com/dd0yz5yxb/image/upload/w_64,h_64,c_lfill,g_auto/v1786328704/searchpet/pets/040f876a/foto.webp',
    );
  });

  it('g_auto para que el recorte caiga en la cara y no en una pata', () => {
    // Un c_lfill sin gravity recorta al centro geometrico. En una foto vertical
    // de un perro, el centro suele ser el lomo: el marcador mostraria pelo.
    expect(cloudinaryThumb(REAL, 64)).toContain('g_auto');
  });

  it('respeta el tamanio pedido', () => {
    expect(cloudinaryThumb(REAL, 128)).toContain('w_128,h_128');
  });

  it('deja intacta una URL que no es de Cloudinary', () => {
    // El seed usa picsum, y una foto puede venir de cualquier lado. Mangling
    // una URL ajena romperia la imagen en vez de optimizarla.
    const ajena = 'https://picsum.photos/seed/foo/800/600';
    expect(cloudinaryThumb(ajena, 64)).toBe(ajena);
  });

  it('deja intacta una URL de Cloudinary que YA trae transformacion', () => {
    // Insertar una segunda transformacion encadena dos recortes y degrada la
    // imagen sin avisar.
    const yaTransformada =
      'https://res.cloudinary.com/dd0yz5yxb/image/upload/w_1200,c_limit/v1786328704/searchpet/pets/x/foto.webp';
    expect(cloudinaryThumb(yaTransformada, 64)).toBe(yaTransformada);
  });

  it('devuelve cadena vacia cuando no hay foto', () => {
    expect(cloudinaryThumb('', 64)).toBe('');
    expect(cloudinaryThumb(undefined, 64)).toBe('');
  });

  it('sin alto explicito sigue siendo cuadrado', () => {
    // Los dos consumidores que ya existian (marcador y fila del mapa) llaman con
    // un solo tamanio. Si el default dejara de ser cuadrado, se deformarian sin
    // que nada mas lo note.
    expect(cloudinaryThumb(REAL, 64)).toContain('w_64,h_64');
  });

  it('acepta un alto distinto del ancho', () => {
    expect(cloudinaryThumb(REAL, 600, 300)).toContain('w_600,h_300');
  });
});

describe('cloudinaryCardThumb', () => {
  it('pide 600x300, la proporcion del contenedor en la grilla mas densa', () => {
    // A `lg` la tarjeta es ~389x192, casi 2:1. En los demas breakpoints NO
    // coincide (~1,85:1 a 768px, ~3,16:1 en una sola columna), asi que
    // object-cover sigue recortando: 600x300 ACHICA ese segundo recorte, no lo
    // elimina. Se elige el breakpoint mas denso porque es el que mas fotos
    // dibuja por pantalla.
    expect(cloudinaryCardThumb(REAL)).toContain('w_600,h_300,c_lfill,g_auto');
  });

  it('usa c_lfill y NUNCA c_fill, porque c_fill agranda', () => {
    // El backend sube con `w_1200,c_limit` y c_limit no agranda, asi que un
    // asset guardado puede medir menos de 600px (una captura, una foto
    // reenviada por WhatsApp). Medido encadenando sobre una foto real achicada
    // a 320px: la fuente pesa 10.062 B, c_fill devuelve 11.346 B —MAS que el
    // original, lo contrario de para lo que existe este helper— y c_lfill
    // devuelve 9.038 B. Con fuentes grandes los dos dan identico (15.430 B
    // sobre un asset de 1200x1600), asi que el mapa no se entera.
    const url = cloudinaryCardThumb(REAL);
    expect(url).toContain('c_lfill');
    expect(url).not.toMatch(/[,/]c_fill[,/]/);
  });

  it('NO agrega f_auto ni q_auto', () => {
    // El backend ya sube webp con q_80, asi que volver a codificar AGRANDA el
    // archivo. Medido sobre una foto real: 29.214 B tal cual contra 32.169 B
    // con f_auto,q_auto.
    const url = cloudinaryCardThumb(REAL);
    expect(url).not.toContain('f_auto');
    expect(url).not.toContain('q_auto');
  });

  it('deja intacta una URL que no es de Cloudinary', () => {
    const ajena = 'https://picsum.photos/seed/foo/800/600';
    expect(cloudinaryCardThumb(ajena)).toBe(ajena);
  });

  // Las tres variantes salen de medir la grilla MAS DENSA de cada pantalla sobre
  // 1216 px de ancho de contenido. Estan fijadas acá porque el numero es la
  // decision: una pantalla que pide la variante de otra no se ve rota, se ve
  // igual y recorta distinto.
  it.each([
    ['feed', 'w_600,h_300', 'HomePage — lg:3 gap-6, caja 389x192'],
    ['adopt', 'w_450,h_300', 'AdoptPage — xl:4 gap-6, caja 286x192'],
    ['compact', 'w_600,h_240', 'MyPetsPage/ProfilePage — lg:3 gap-4, caja 395x160'],
  ] as const)('la variante %s pide %s (%s)', (variante, medida) => {
    expect(cloudinaryCardThumb(REAL, variante)).toContain(`${medida},c_lfill,g_auto`);
  });

  it('las tres variantes son distintas entre si', () => {
    // Si dos colapsan al mismo valor, la variante dejo de significar algo y
    // alguna pantalla esta recortando con la proporcion de otra.
    const urls = [
      cloudinaryCardThumb(REAL, 'feed'),
      cloudinaryCardThumb(REAL, 'adopt'),
      cloudinaryCardThumb(REAL, 'compact'),
    ];
    expect(new Set(urls).size).toBe(3);
  });
});
