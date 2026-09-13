import { test, expect, type Page } from '@playwright/test';

/**
 * NINGÚN TEXTO DE LAS RUTAS PÚBLICAS BAJA DEL UMBRAL WCAG AA EN MODO OSCURO.
 *
 * POR QUÉ ESTO NO PUEDE SER UN TEST UNITARIO: jsdom no computa CSS de Tailwind,
 * así que `getComputedStyle` en Vitest devuelve cadenas vacías. El contraste
 * sólo se puede medir en un navegador de verdad — por eso vive acá y no en
 * `src/**\/*.test.tsx`.
 *
 * POR QUÉ EXISTE: el #240 arregló tres pares de `StoryCard` que daban 3.72:1 y
 * nada impedía que volvieran. Al escribir este guard se midió el resto del sitio
 * y el MISMO defecto estaba vivo en el navbar, el footer, el home, el login, el
 * registro y los refugios: `--color-primary` está calibrado para llevar texto
 * BLANCO ENCIMA (4.77:1), no para ser el color del texto, y sobre el fondo
 * oscuro da 3.72:1.
 *
 * ARRANCA SIN ALLOWLIST, y es deliberado: se llegó a cero antes de mergearlo.
 * Una lista de excepciones envejece sin que nadie la mire y termina dando la
 * sensación de estar al día mientras deja de cubrir — ya pasó dos veces en este
 * repo. Si algún día hace falta una, que venga con el motivo escrito al lado y
 * con un test que la marque cuando deje de aplicar.
 */

/** Los paths REALES de `App.tsx`. Ver el comentario de `CANARIO` abajo. */
const RUTAS_PUBLICAS = [
  '/',
  '/map',
  '/adopt',
  '/shelters',
  '/leaderboard',
  '/stories',
  '/login',
  '/register',
];

/**
 * Piso de nodos con texto por ruta.
 *
 * SIN ESTO EL GUARD NO SIRVE, y no es teoría: mientras se escribía, cuatro de
 * las rutas apuntaban a paths que no existen (`/mapa`, `/refugios`…), la app no
 * montaba, y las cuatro reportaban "0 bajo umbral" — indistinguible de un
 * aprobado. Un guard que mide cero casos informa lo mismo que uno donde está
 * todo bien.
 *
 * El número sale de la corrida real más flaca (`/adopt`, 24 nodos) con margen.
 */
const CANARIO = 15;

/** Lo que se inyecta en la página. Se declara acá para que el tipo lo cubra. */
interface Resultado {
  hallazgos: Array<{
    texto: string;
    tag: string;
    clases: string;
    ratio: number;
    umbral: number;
    px: number;
    peso: number;
  }>;
  medidos: number;
  oscuro: boolean;
}

function medirContraste(): Resultado {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;

  /**
   * Pinta `color` sobre `debajo` y devuelve el RGB resultante.
   *
   * EL COLOR NO SE PARSEA DE LA CADENA de `getComputedStyle`: Tailwind v4 emite
   * los grises en `oklch()` y la opacidad como `oklab(… / .1)`. Leer esos
   * números a mano y tratarlos como RGB da un resultado PLAUSIBLE y FALSO — en
   * el #240 dio 3.64 donde el valor real era 7.92. El canvas hace que el
   * navegador resuelva el espacio de color y el alfa por nosotros.
   */
  const componer = (color: string, debajo: number[] | null): number[] => {
    cx.clearRect(0, 0, 1, 1);
    if (debajo) {
      cx.fillStyle = `rgb(${debajo[0]},${debajo[1]},${debajo[2]})`;
      cx.fillRect(0, 0, 1, 1);
    }
    cx.fillStyle = color;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };

  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  /**
   * El fondo EFECTIVO, compuesto desde la raíz hacia abajo.
   *
   * No alcanza con el `background-color` del elemento ni con el del padre: un
   * `bg-primary/15` sobre `dark:bg-gray-900` no es ninguno de los dos, y es
   * justo el caso del badge que el #240 midió mal la primera vez.
   */
  const fondoDe = (el: Element): number[] => {
    const cadena: string[] = [];
    for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') cadena.push(bg);
    }
    cadena.push(getComputedStyle(document.documentElement).backgroundColor || 'rgb(255,255,255)');
    let acumulado: number[] | null = null;
    for (const bg of cadena.reverse()) acumulado = componer(bg, acumulado);
    return acumulado!;
  };

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };

  const hallazgos: Resultado['hallazgos'] = [];
  let medidos = 0;

  for (const el of Array.from(document.querySelectorAll('body *'))) {
    // Sólo nodos con texto PROPIO: si no, cada contenedor reporta el texto de
    // sus hijos con su propio `color`, que no es el que se ve.
    const propio = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent ?? '').trim())
      .join(' ')
      .trim();

    // UN EMOJI NO SE PINTA CON `color`: el navegador lo dibuja con su propia
    // paleta, como una imagen. Medirle el ratio contra el fondo da un número sin
    // sentido — los seis badges del ranking daban 1.41:1 sobre emojis
    // perfectamente visibles. WCAG les aplica el criterio de gráficos.
    const sinPictogramas = propio.replace(/\p{Extended_Pictographic}|️|‍/gu, '').trim();
    if (!sinPictogramas || !visible(el)) continue;
    medidos++;

    const s = getComputedStyle(el);
    const px = parseFloat(s.fontSize);
    const peso = Number(s.fontWeight) || 400;
    // WCAG 1.4.3: "texto grande" son 24px, o 18.66px si es bold. Ahí el umbral
    // baja a 3:1. Todo lo demás pide 4.5:1.
    const grande = px >= 24 || (px >= 18.66 && peso >= 700);
    const umbral = grande ? 3 : 4.5;

    const fondo = fondoDe(el);
    const texto = componer(s.color, fondo);
    const r = ratio(texto, fondo);

    if (r < umbral) {
      hallazgos.push({
        texto: propio.slice(0, 40),
        tag: el.tagName.toLowerCase(),
        clases: (el.getAttribute('class') ?? '').slice(0, 80),
        ratio: Math.round(r * 100) / 100,
        umbral,
        px: Math.round(px * 10) / 10,
        peso,
      });
    }
  }

  return { hallazgos, medidos, oscuro: document.documentElement.classList.contains('dark') };
}

async function enModoOscuro(page: Page, ruta: string): Promise<Resultado> {
  await page.goto(ruta);
  // `networkidle` y no `load`: las listas llegan por query y su texto es
  // justamente el que interesa medir.
  await page.waitForLoadState('networkidle');
  return page.evaluate(medirContraste);
}

test.describe('contraste WCAG AA en modo oscuro', () => {
  test.beforeEach(async ({ context }) => {
    // El tema sale de `localStorage` (`ThemeContext.getInitialTheme`), así que
    // se siembra ANTES de que cargue cualquier documento. Con `emulateMedia` no
    // alcanza: la preferencia guardada le gana a la del sistema.
    await context.addInitScript(() => {
      localStorage.setItem('searchpet-theme', 'dark');
      localStorage.setItem('searchpet-lang', 'es');
    });
  });

  for (const ruta of RUTAS_PUBLICAS) {
    test(`${ruta} — ningún texto por debajo del umbral`, async ({ page }) => {
      const { hallazgos, medidos, oscuro } = await enModoOscuro(page, ruta);

      // LAS DOS AFIRMACIONES QUE TIENEN QUE IR ANTES DEL RESULTADO. Sin ellas,
      // "cero hallazgos" también se emite cuando la app no montó o cuando el
      // tema no se aplicó — la misma forma que un `curl` sin `--fail`.
      expect(oscuro, `${ruta}: la raíz no tiene la clase .dark`).toBe(true);
      expect(medidos, `${ruta}: sólo ${medidos} nodos con texto — ¿montó la app?`)
        .toBeGreaterThanOrEqual(CANARIO);

      const detalle = hallazgos
        .map((h) => `  ${h.ratio}:1 < ${h.umbral}  ${h.px}px/${h.peso}  <${h.tag}> "${h.texto}"  [${h.clases}]`)
        .join('\n');

      expect(
        hallazgos,
        `${ruta}: ${hallazgos.length} textos por debajo del umbral AA en modo oscuro:\n${detalle}\n\n` +
          `Para texto, en oscuro usá \`dark:text-primary-light\` (el \`primary\` está ` +
          `calibrado para llevar blanco encima, no para SER el texto) y \`dark:text-gray-400\` ` +
          `en vez de \`gray-500\` (el gris del modo oscuro va más CLARO, no más oscuro).`
      ).toEqual([]);
    });
  }
});
