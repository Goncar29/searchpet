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
        })
    );

  if (pendientes.length === 0) return Promise.resolve();

  return Promise.race([
    Promise.all(pendientes).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
