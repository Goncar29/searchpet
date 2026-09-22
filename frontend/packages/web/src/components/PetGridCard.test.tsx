import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PetGridCard } from './PetGridCard';
import type { Pet } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es' },
  }),
}));

const FOTO = 'https://res.cloudinary.com/demo/image/upload/v1/pets/luna.jpg';

// El `Pet` completo tiene muchos campos opcionales que esta tarjeta no mira;
// se arma el mínimo y se deja que TypeScript valide los que sí existen — sin
// `as Pet`, que es justamente lo que dejaría pasar un `type` inventado.
function mascota(extra: Partial<Pet> = {}): Pet {
  return {
    id: 'p1',
    name: 'Luna',
    type: 'perro',
    status: 'lost',
    photos: [{ id: 'f1', url: FOTO, is_primary: true, created_at: '2026-01-01T00:00:00Z' }],
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function dibujar(props: Partial<Parameters<typeof PetGridCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PetGridCard
        pet={mascota()}
        thumb="feed"
        badgeLabel="PERDIDA"
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('PetGridCard', () => {
  // La variante es el motivo por el que esto es una prop y no una constante:
  // cada grilla mide distinto y el número salió de medirla (Adoptar ~280px ->
  // 'adopt'; Perfil ~376px -> 'feed'). Si el componente eligiera una sola,
  // una de las dos pantallas serviría una foto borrosa o de más — y ninguna
  // de las dos fallaría, sólo gastaría distinto.
  it('pide la miniatura de la variante que recibe', () => {
    dibujar({ thumb: 'adopt' });
    expect((screen.getByAltText('Luna') as HTMLImageElement).src).toContain('w_450,h_300');
  });

  it('otra variante pide otra medida', () => {
    dibujar({ thumb: 'feed' });
    expect((screen.getByAltText('Luna') as HTMLImageElement).src).toContain('w_600,h_300');
  });

  // `font-display` fija la FAMILIA, no el peso: el preflight de Tailwind v4
  // deja los h1-h6 en `font-weight: inherit` y `text-lg` no trae peso propio
  // (a diferencia de `text-headline`/`text-display`). Sin `font-semibold` el
  // nombre cae a 400 — regresión del #161, ya vivida dos veces.
  it('el nombre va en la familia display con el peso declarado', () => {
    dibujar();
    const titulo = screen.getByRole('heading', { name: 'Luna' });
    expect(titulo.className).toContain('font-display');
    expect(titulo.className).toContain('text-lg');
    expect(titulo.className).toContain('font-semibold');
  });

  // El TEXTO lo decide el llamador (Adoptar lo fija porque su allowlist tiene
  // un solo estado; Perfil mezcla estados y lo deriva) pero el COLOR sale
  // siempre del status. Si el color se volviera fijo, una tarjeta `found`
  // se pintaría igual que una `lost` y nada fallaría.
  it('el color del badge sale del status, no de la etiqueta', () => {
    const { unmount } = dibujar({ pet: mascota({ status: 'lost' }) });
    const perdida = screen.getByText('PERDIDA').className;
    unmount();

    dibujar({ pet: mascota({ status: 'found' }), badgeLabel: 'PERDIDA' });
    const encontrada = screen.getByText('PERDIDA').className;

    // Misma etiqueta, distinto status -> tiene que pintar distinto.
    expect(perdida).not.toBe(encontrada);
  });

  it('dibuja la etiqueta que recibe', () => {
    dibujar({ badgeLabel: 'EN ADOPCION' });
    expect(screen.getByText('EN ADOPCION')).toBeTruthy();
  });

  // El nombre promete DOS cosas, así que se afirman las DOS. Afirmar sólo la
  // ausencia de la `<img>` dejaba pasar que alguien borrara la rama `else`:
  // cada tarjeta sin foto quedaría como un rectángulo gris vacío, el alto ni
  // se movería —lo sostiene `h-48`— y la suite seguiría verde.
  it('sin foto dibuja el placeholder y ninguna imagen', () => {
    dibujar({ pet: mascota({ photos: [] }) });

    // El placeholder es el `Logo`, que se anuncia con `role="img"` y este
    // `aria-label`; es el mismo handle que usa `PhotoBanner.test.tsx`.
    expect(screen.getByLabelText('SearchPet')).toBeTruthy();
    expect(screen.queryByAltText('Luna')).toBeNull();
  });

  // Los tres datos van en UNA línea unida por ' · ', y los vacíos no dejan
  // separadores colgando.
  it('une los metadatos salteando los vacios', () => {
    dibujar({ pet: mascota({ type: 'perro', breed: 'Labrador', color: undefined }) });
    expect(screen.getByText('pets:types.perro · Labrador')).toBeTruthy();
  });

  // La línea de ciudad reserva su alto aunque esté vacía: sin eso, una tarjeta
  // sin ciudad queda más baja que sus vecinas y la grilla se desparrama.
  //
  // Se fija LA LÍNEA DE CIUDAD, no un conteo de elementos con la clase: un
  // conteo pasaría igual si esta línea perdiera su `min-h` y otra ganara un
  // duplicado, y se rompería sin motivo el día que alguien agregue un tercer
  // elemento que también reserve alto.
  it('sin ciudad la linea sigue existiendo y con su alto reservado', () => {
    const { container } = dibujar({ pet: mascota({ city: undefined }) });

    // La última línea del bloque de info es la de ciudad.
    const lineas = container.querySelectorAll('.p-4 > p');
    const ciudad = lineas[lineas.length - 1];

    expect(ciudad.textContent).toBe('');
    expect(ciudad.className).toContain('min-h-[1.25rem]');
  });

  it('enlaza al detalle de la mascota', () => {
    const { container } = dibujar();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/pets/p1');
  });

  // La tarjeta ENTERA es el enlace, así que nada de lo que dibuje puede ser
  // interactivo. Un `<a>` dentro de otro es HTML inválido y le da al mismo
  // destino dos entradas en la lista de enlaces de un lector de pantalla.
  //
  // El guard cuenta los anclas en vez de mirar el primero: `querySelector('a')`
  // devuelve uno aunque haya tres, así que no puede ver este defecto. Se afirma
  // CON children, que es el único camino por el que puede entrar uno de más.
  it('la tarjeta es UN solo enlace, aun con contenido extra', () => {
    const { container } = dibujar({
      children: (
        <span>
          ver perfil <span aria-hidden>›</span>
        </span>
      ),
    });

    expect(container.querySelectorAll('a').length).toBe(1);
  });

  // Adoptar agrega descripción y un CTA debajo de la ciudad; Perfil no agrega
  // nada. Por eso es `children` y no un booleano: la ausencia de contenido
  // extra no es una decisión que alguien tenga que tomar.
  it('dibuja el contenido extra que le pasan', () => {
    dibujar({ children: <p>un comentario</p> });
    expect(screen.getByText('un comentario')).toBeTruthy();
  });
});
