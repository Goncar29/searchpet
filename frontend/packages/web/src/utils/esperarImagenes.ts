/**
 * Espera a que todas las `<img>` de un nodo terminen de cargar.
 *
 * POR QUÉ EXISTE: los templates que html2canvas rasteriza (el volante que se
 * imprime y la story de Instagram) se montaban SIEMPRE, offscreen, desde que se
 * abría la página de detalle. Eso bajaba la foto original en cada visita, la
 * usara alguien o no.
 *
 * Al montarlos recién cuando se los va a capturar, el costo desaparece — pero
 * aparece una carrera que antes no existía: la `<img>` recién empieza a
 * descargar cuando el nodo entra al DOM, y html2canvas dibuja lo que haya en ese
 * instante. Sin esperar, el volante sale **sin la mascota**, que es peor que el
 * problema que se estaba arreglando.
 *
 * `onerror` resuelve igual que `onload` a propósito: una foto que no carga no
 * puede bloquear la generación del volante para siempre. html2canvas ya tiene su
 * propio manejo para una imagen rota; lo que no tiene es paciencia para una que
 * todavía está en camino.
 *
 * El timeout es la red de contención del caso patológico (una imagen que nunca
 * resuelve ni falla, por ejemplo con la conexión cortada a mitad de descarga):
 * sin él, `Promise.all` no vuelve nunca y el botón queda hilando para siempre.
 */
export function esperarImagenes(nodo: HTMLElement, timeoutMs = 10_000): Promise<void> {
  const imgs = Array.from(nodo.querySelectorAll('img'));
  const limpiezas: Array<() => void> = [];

  const pendientes = imgs
    // `complete` sola no alcanza: una imagen que ya FALLÓ también está
    // `complete`, con `naturalWidth` en 0. Se la deja pasar igual —no se puede
    // hacer nada por ella— pero por la rama de "ya terminó", no esperándola.
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise<void>((resolve) => {
          const listo = () => {
            img.removeEventListener('load', listo);
            img.removeEventListener('error', listo);
            resolve();
          };
          img.addEventListener('load', listo);
          img.addEventListener('error', listo);
          // Para poder soltarlos también cuando gana el timeout: ahí `listo`
          // no corre nunca y los listeners quedarían colgados del nodo.
          limpiezas.push(() => {
            img.removeEventListener('load', listo);
            img.removeEventListener('error', listo);
          });
        })
    );

  if (pendientes.length === 0) return Promise.resolve();

  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    Promise.all(pendientes).then(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]).finally(() => {
    // `Promise.race` descarta al perdedor pero no lo cancela: sin esto el timer
    // sigue vivo diez segundos después de cada captura exitosa, sosteniendo su
    // closure.
    clearTimeout(timer);
    limpiezas.forEach((f) => f());
  });
}

/**
 * Cede el control hasta que el navegador haya pintado.
 *
 * ES DEFENSA EN PROFUNDIDAD, Y CONVIENE SER PRECISO SOBRE QUÉ SE SABE.
 *
 * El riesgo que cubre: `esperarImagenes` resuelve desde un listener de `load`,
 * y el `await` que le sigue continúa en un **microtask**, o sea potencialmente
 * antes de que React haya commiteado lo que ese mismo `load` disparó. Dos cosas
 * dependen de ese commit:
 *
 * 1. `PhotoBanner` calcula las dimensiones "contain" en su `onLoad` y las fija
 *    en píxeles explícitos, porque html2canvas 1.4.x **ignora `object-fit`** y
 *    estira la imagen a su caja. Capturar antes del commit rasterizaría el
 *    estilo viejo y la foto saldría deformada en el impreso.
 * 2. `QRCodeCanvas` dibuja en un `useEffect` (passive), que `flushSync` NO
 *    alcanza: se agenda en la cola del Scheduler.
 *
 * **MEDIDO: la carrera no se reprodujo.** Parcheando `cloneNode` para leer el
 * estilo del `<img>` en el instante exacto en que html2canvas clona, y con el
 * `await cederAlRender()` quitado, el clon YA traía `712px x 237px` — o sea las
 * dimensiones "contain" aplicadas. Presumiblemente porque html2canvas hace
 * trabajo asíncrono propio antes de clonar, y eso alcanza para que React
 * commitee.
 *
 * Se deja igual, y el motivo no es la superstición: el margen depende de
 * detalles internos de html2canvas que nadie garantiza, el modo de falla es
 * silencioso y caro (un volante impreso con la mascota deformada), y el costo
 * son dos frames —unos 32 ms— dentro de una operación que ya tarda segundos.
 * Lo que NO hay que hacer es escribir en el commit que "sin esto la foto sale
 * deformada": eso no está medido, y esta misma sesión demostró varias veces lo
 * caro que sale afirmar de más.
 *
 * Dos frames y no uno: el primero corre después del commit, el segundo después
 * del paint que ese commit produjo.
 */
export function cederAlRender(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}
