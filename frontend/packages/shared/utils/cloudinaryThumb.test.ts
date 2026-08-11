import { describe, it, expect } from 'vitest';
import { cloudinaryThumb } from './cloudinaryThumb';

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
});
