import { describe, it, expect, vi, afterEach } from 'vitest';
import { esperarImagenes, cederAlRender } from './esperarImagenes';

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

  // `Promise.race` descarta al perdedor pero NO lo cancela: sin el `clearTimeout`
  // cada captura exitosa dejaba un timer vivo diez segundos, sosteniendo su
  // closure. Se mide con los timers pendientes del fake scheduler.
  it('cancela el timer cuando las imágenes ganan la carrera', async () => {
    vi.useFakeTimers();
    const pendiente = img(false);
    const p = esperarImagenes(contenedor(pendiente), 10_000);

    expect(vi.getTimerCount(), 'debería haber un timer de timeout armado').toBe(1);

    pendiente.dispatchEvent(new Event('load'));
    await p;

    expect(vi.getTimerCount(), 'el timer del timeout quedó vivo tras resolver').toBe(0);
  });

  // Y en la rama del timeout `listo` no corre nunca, así que sin la limpieza los
  // listeners quedaban colgados del nodo.
  it('suelta los listeners también cuando gana el timeout', async () => {
    vi.useFakeTimers();
    const zombi = img(false);
    const quitar = vi.spyOn(zombi, 'removeEventListener');

    const p = esperarImagenes(contenedor(zombi), 500);
    await vi.advanceTimersByTimeAsync(501);
    await p;

    const quitados = quitar.mock.calls.map((c) => c[0]);
    expect(quitados).toContain('load');
    expect(quitados).toContain('error');
  });
});

describe('cederAlRender', () => {
  // No es un `sleep` de conveniencia: `esperarImagenes` resuelve desde un
  // listener de `load` y el `await` sigue como MICROTASK, o sea antes de que
  // React commitee lo que ese `load` disparó. `PhotoBanner` fija ahí las
  // dimensiones "contain" en píxeles —html2canvas ignora `object-fit`— y el QR
  // se dibuja en un `useEffect` que `flushSync` no alcanza.
  it('espera DOS frames, no uno', async () => {
    const frames: Array<() => void> = [];
    const raf = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(() => cb(0));
        return frames.length;
      });

    let resuelto = false;
    cederAlRender().then(() => {
      resuelto = true;
    });

    // Primer frame: todavía no.
    frames.shift()!();
    await Promise.resolve();
    expect(resuelto, 'resolvió con un solo frame').toBe(false);

    // Segundo frame: ahora sí.
    frames.shift()!();
    await Promise.resolve();
    expect(resuelto).toBe(true);

    raf.mockRestore();
  });
});
