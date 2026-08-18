import { describe, it, expect } from 'vitest';
import { cloudinaryThumb, cloudinaryCardThumb } from './cloudinaryThumb';

const REAL =
  'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1786328704/searchpet/pets/040f876a/foto.webp';

describe('cloudinaryThumb', () => {
  it('inserta la transformacion despues de /upload/', () => {
    expect(cloudinaryThumb(REAL, 64)).toBe(
      'https://res.cloudinary.com/dd0yz5yxb/image/upload/w_64,h_64,c_fill,g_auto/v1786328704/searchpet/pets/040f876a/foto.webp',
    );
  });

  it('g_auto para que el recorte caiga en la cara y no en una pata', () => {
    // Un c_fill sin gravity recorta al centro geometrico. En una foto vertical
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
  it('pide 600x300, la proporcion del contenedor de la tarjeta', () => {
    // La tarjeta dibuja h-48 a ancho completo (~389x192, o sea 2:1) y encima
    // aplica object-cover. Pedir un cuadrado hace que Cloudinary recorte con
    // g_auto y el navegador vuelva a recortar arriba y abajo, ignorando la
    // gravity: ese segundo recorte es el que corta cabezas.
    expect(cloudinaryCardThumb(REAL)).toContain('w_600,h_300,c_fill,g_auto');
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
});
