import { describe, it, expect, vi, afterEach } from 'vitest';
import { esperarImagenes } from './esperarImagenes';

/**
 * OJO CON EL ARNÉS, que es lo que hace este archivo necesario: en jsdom una
 * `<img>` con `src` queda con `complete === false` PARA SIEMPRE y no dispara ni
 * `load` ni `error`, porque jsdom no carga recursos. O sea que el entorno de
 * tests se comporta como el peor caso patológico de producción.
 *
 * Por eso las imágenes de acá se arman a mano con `complete` definido a
 * propósito y los eventos disparados desde el test, y por eso los tests de
 * `SharePanel`/`PdfFlyerButton` mockean este módulo: allá se ejercita la lógica
 * de compartir, no la espera.
 */
function img(complete: boolean): HTMLImageElement {
  const el = document.createElement('img');
  Object.defineProperty(el, 'complete', { value: complete, configurable: true });
  return el;
}

function contenedor(...imgs: HTMLImageElement[]): HTMLElement {
  const div = document.createElement('div');
  imgs.forEach((i) => div.appendChild(i));
  return div;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('esperarImagenes', () => {
  it('resuelve enseguida cuando no hay imágenes', async () => {
    await expect(esperarImagenes(contenedor())).resolves.toBeUndefined();
  });

  it('resuelve enseguida cuando todas ya cargaron', async () => {
    await expect(esperarImagenes(contenedor(img(true), img(true)))).resolves.toBeUndefined();
  });

  it('espera a la que falta y resuelve con su load', async () => {
    const pendiente = img(false);
    const nodo = contenedor(img(true), pendiente);

    let resuelto = false;
    const p = esperarImagenes(nodo).then(() => {
      resuelto = true;
    });

    // Todavía no: hay una imagen en vuelo.
    await Promise.resolve();
    expect(resuelto).toBe(false);

    pendiente.dispatchEvent(new Event('load'));
    await p;
    expect(resuelto).toBe(true);
  });

  // Una foto rota no puede dejar el botón hilando para siempre: el volante se
  // genera igual, sin ella. `error` tiene que resolver, no rechazar.
  it('resuelve también cuando la imagen falla', async () => {
    const rota = img(false);
    const p = esperarImagenes(contenedor(rota));
    rota.dispatchEvent(new Event('error'));
    await expect(p).resolves.toBeUndefined();
  });

  it('espera a TODAS, no a la primera', async () => {
    const a = img(false);
    const b = img(false);
    let resuelto = false;
    const p = esperarImagenes(contenedor(a, b)).then(() => {
      resuelto = true;
    });

    a.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(resuelto, 'resolvió con una sola de las dos cargadas').toBe(false);

    b.dispatchEvent(new Event('load'));
    await p;
    expect(resuelto).toBe(true);
  });

  // La red de contención del caso patológico: una imagen que no carga NI falla
  // (la conexión se corta a mitad de la descarga). Sin esto, `Promise.all` no
  // vuelve nunca y el botón queda generando para siempre.
  it('resuelve por timeout si la imagen no carga ni falla', async () => {
    vi.useFakeTimers();
    const zombi = img(false);
    let resuelto = false;
    const p = esperarImagenes(contenedor(zombi), 500).then(() => {
      resuelto = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(resuelto, 'resolvió antes del timeout').toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(resuelto).toBe(true);
  });

  // `complete` es true también para una imagen que YA falló (con naturalWidth
  // en 0). Se la deja pasar por la rama de "ya terminó" y no se la espera, que
  // es lo correcto: no hay nada que esperar.
  it('no espera a una imagen que ya terminó, haya cargado o no', async () => {
    vi.useFakeTimers();
    const yaFallo = img(true);
    Object.defineProperty(yaFallo, 'naturalWidth', { value: 0, configurable: true });

    let resuelto = false;
    esperarImagenes(contenedor(yaFallo), 500).then(() => {
      resuelto = true;
    });

    // Sin avanzar un solo tick del timeout.
    await vi.advanceTimersByTimeAsync(0);
    expect(resuelto).toBe(true);
  });
});
