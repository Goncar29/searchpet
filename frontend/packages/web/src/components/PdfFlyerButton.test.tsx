import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PdfFlyerButton } from './PdfFlyerButton';
import type { Pet } from '@shared/types';

/**
 * EL TEMPLATE YA NO ESTÁ MONTADO AL RENDERIZAR, y por eso estos tests cambiaron
 * de forma. Antes vivía siempre en el DOM —bajando la foto original en cada
 * visita a la página de detalle, la imprimiera alguien o no— y alcanzaba con
 * `render()` + `querySelector`.
 *
 * Ahora se afirma sobre **el nodo que html2canvas recibe**, que además es una
 * garantía más fiel: lo que importa no es que el template exista en algún
 * momento, sino que lo que se rasteriza tenga el banner, el título y el header
 * correctos.
 */
const capturado: { nodo: HTMLElement | null } = { nodo: null };

vi.mock('html2canvas', () => ({
  default: vi.fn(async (nodo: HTMLElement) => {
    // Se clona porque el componente desmonta el template apenas termina: sin
    // esto, para cuando el test mira el nodo ya está vacío.
    capturado.nodo = nodo.cloneNode(true) as HTMLElement;
    return {
      width: 794,
      height: 1123,
      toDataURL: () => 'data:image/jpeg;base64,x',
    };
  }),
}));

vi.mock('jspdf', () => ({
  default: vi.fn(() => ({
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    addImage: vi.fn(),
    save: vi.fn(),
  })),
}));

// En jsdom una `<img>` nunca resuelve (`complete` queda en false y no dispara
// load ni error), así que la espera real colgaría hasta su timeout. La lógica de
// la espera tiene su propio test en `utils/esperarImagenes.test.ts`.
vi.mock('../utils/esperarImagenes', () => ({
  esperarImagenes: vi.fn(async () => undefined),
}));

vi.mock('@shared/hooks', () => ({
  useShareLink: () => ({
    mutateAsync: vi.fn(async () => ({ share_url: 'https://searchpet.app/share/abc' })),
    isPending: false,
  }),
}));

const basePet: Pet = {
  id: 'pet-1',
  name: 'Firulais',
  type: 'perro',
  breed: 'Labrador',
  color: 'dorado',
  status: 'lost',
  photos: [{ id: 'ph-1', url: 'https://img.test/dog.jpg', is_primary: true, created_at: '' }],
  created_at: new Date().toISOString(),
};

/** Dispara la generación y devuelve el nodo que html2canvas recibió. */
async function generar(pet: Pet): Promise<HTMLElement> {
  const { getByRole } = render(<PdfFlyerButton pet={pet} />);
  await userEvent.click(getByRole('button'));
  await waitFor(() => expect(capturado.nodo).not.toBeNull());
  return capturado.nodo!;
}

beforeEach(() => {
  capturado.nodo = null;
});

describe('PdfFlyerButton — el template sólo existe mientras se captura', () => {
  // La mitad nueva, y la que da sentido al cambio: sin esta aserción, montar el
  // template siempre volvería a pasar sin que nada falle.
  it('NO monta el template al renderizar', () => {
    const { container } = render(<PdfFlyerButton pet={basePet} />);
    expect(container.querySelector('[data-testid="flyer-template"]')).toBeNull();
    // Y la foto tampoco: ese <img> es el que bajaba el original en cada visita.
    expect(container.querySelector('img[alt="Firulais"]')).toBeNull();
  });

  it('lo desmonta cuando termina de generar', async () => {
    const { getByRole, container } = render(<PdfFlyerButton pet={basePet} />);
    await userEvent.click(getByRole('button'));
    await waitFor(() => expect(capturado.nodo).not.toBeNull());
    await waitFor(() =>
      expect(container.querySelector('[data-testid="flyer-template"]')).toBeNull()
    );
  });
});

describe('PdfFlyerButton — lo que html2canvas rasteriza', () => {
  it('lleva un banner 4:3 a ancho completo arriba del título', async () => {
    const nodo = await generar(basePet);

    const img = nodo.querySelector('img[alt="Firulais"]') as HTMLImageElement;
    const title = nodo.querySelector('h1');

    expect(img).toBeTruthy();
    expect(img.style.objectFit).toBe('contain');
    expect(title?.textContent).toBe('Firulais');

    const bannerWrapper = img.parentElement as HTMLElement;
    expect(bannerWrapper.style.height).toBe('536px');

    // El banner debe aparecer antes que el título en el DOM
    const position = img.compareDocumentPosition(title!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('muestra el placeholder de la patita cuando no hay foto', async () => {
    const nodo = await generar({ ...basePet, photos: [] });
    expect(nodo.querySelector('img[alt="Firulais"]')).toBeNull();
    expect(nodo.querySelector('[aria-label="SearchPet"]')).toBeTruthy();
  });

  it('rasteriza el QR ya resuelto, no vacío', async () => {
    // El template se monta DESPUÉS de tener el share link, a propósito: montarlo
    // antes capturaría el volante con el QR sin resolver.
    const nodo = await generar(basePet);
    expect(nodo.textContent).toContain('https://searchpet.app/share/abc');
  });
});

describe('PdfFlyerButton — adoption framing', () => {
  it('usa el header EN ADOPCIÓN y la fila de ciudad', async () => {
    const nodo = await generar({ ...basePet, status: 'adoption', city: 'Montevideo' });
    expect(nodo.textContent).toContain('¡EN ADOPCIÓN!');
    expect(nodo.textContent).toContain('Montevideo');
    expect(nodo.textContent).not.toContain('¡MASCOTA PERDIDA!');
  });

  it('mantiene el header de perdida para mascotas lost', async () => {
    const nodo = await generar({ ...basePet, status: 'lost', city: undefined });
    expect(nodo.textContent).toContain('¡MASCOTA PERDIDA!');
  });
});
