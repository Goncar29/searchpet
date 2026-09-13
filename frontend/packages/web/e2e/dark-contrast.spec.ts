import { test, expect, type Page } from '@playwright/test';
import { uniqueEmail, seedUser, getToken, seedStray, markFound, seedStory } from './helpers';

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
interface Ruta {
  path: string;
  /**
   * Un texto que SÓLO aparece si la lista de esa ruta renderizó de verdad.
   *
   * ES LA MITAD QUE FALTABA DEL CANARIO. `CANARIO` prueba que montó el shell —
   * navbar, footer, encabezado— pero **no distingue "la lista se dibujó y está
   * limpia" de "la lista está vacía"**. Y esa diferencia no es teórica: con la
   * base del e2e recién creada, `/`, `/adopt`, `/leaderboard` y `/stories`
   * llegan sin datos, así que "cero hallazgos" sólo certificaba el estado
   * vacío. Por eso ocho instancias del MISMO defecto sobrevivieron a un guard
   * que daba verde — las encontró un code review, no el guard.
   *
   * `/shelters` fue la excepción, y es la prueba del mecanismo: el seed del CI
   * le da 7 refugios, sus tarjetas se dibujan, y ahí el guard SÍ encontró los
   * 26 textos que motivaron el segundo commit de este PR.
   *
   * Donde se puede sembrar, se siembra y se exige el ancla. Donde no, queda
   * escrito abajo qué región no se está midiendo.
   */
  ancla?: () => RegExp;
  /** Qué queda SIN medir en esta ruta, para no leer su verde como cobertura. */
  sinCubrir?: string;
}

const RUTAS_PUBLICAS: Ruta[] = [
  // Sembradas en `beforeAll`: sus tarjetas se miden de verdad.
  { path: '/', ancla: () => new RegExp(nombreMascota) },
  { path: '/stories', ancla: () => new RegExp(tituloHistoria) },
  // El seed del CI le pone 7 refugios; localmente puede venir vacía, así que el
  // ancla es opcional y lo que se afirma es el `sinCubrir`.
  { path: '/shelters', sinCubrir: 'las tarjetas sólo se miden si la base tiene refugios' },
  { path: '/map', sinCubrir: 'los marcadores viven en el canvas de Leaflet, no son texto' },
  { path: '/adopt', sinCubrir: 'las tarjetas de adopción: el e2e no siembra ninguna' },
  { path: '/leaderboard', sinCubrir: 'la tabla: pide una ciudad, y sin buscarla queda en su estado idle' },
  { path: '/login' },
  { path: '/register' },
];

// Datos sembrados una sola vez para que `/` y `/stories` tengan contenido real.
let nombreMascota = '';
let tituloHistoria = '';

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
  noMedibles: string[];
}

function medirContraste(): Resultado {
  // Paradas de gradiente que el navegador no reconoce como color. Se reportan:
  // un fondo que no se pudo medir no es un fondo aprobado.
  const noMedibles: string[] = [];

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
   * Los fondos CANDIDATOS detrás de un elemento. El veredicto usa el PEOR.
   *
   * Devuelve una lista y no un color por los GRADIENTES. Un elemento con
   * `bg-gradient-to-br from-primary to-primary-dark` tiene `backgroundColor`
   * TRANSPARENTE: el color vive en `background-image`. Una cadena que sólo mira
   * `backgroundColor` se lo saltea y termina midiendo contra el fondo de más
   * atrás — que no es el que se ve.
   *
   * Y eso no era teórico: los héroes de `/`, `/adopt`, `/shelters` y
   * `/leaderboard` son gradientes naranjas con texto blanco encima. Medido, un
   * `text-white/70` ahí da **3.13:1** contra el gradiente real y **9.80:1**
   * contra el `gray-950` que la cadena alcanzaba. O sea que el guard aprobaba
   * con holgura un texto que en la pantalla no se lee — un falso negativo
   * silencioso, que es el peor modo de falla que puede tener un guard.
   *
   * Las paradas del gradiente se sacan del `background-image` y se pintan en el
   * canvas como cualquier otro color (así se resuelven `oklch`/`oklab` sin
   * parsearlos). Tomar el ratio MÍNIMO contra todas las paradas es lo correcto:
   * si el texto se lee contra la parada más desfavorable, se lee en todo el
   * gradiente.
   *
   * Lo que sigue sin cubrir: una IMAGEN de fondo (`url(...)`), cuyo color no se
   * puede conocer sin muestrear píxeles. Ahí la cadena se la saltea igual que
   * antes, y queda anotado en vez de fingir que se midió.
   */
  /**
   * ¿Este color tapa por completo lo que tenga detrás?
   *
   * Se resuelve pintándolo sobre blanco y sobre negro: si los dos dan lo mismo,
   * no deja pasar nada. No se parsea el alfa de la cadena — con `oklch()` y
   * `color(...)` ese parseo es justamente lo que este archivo evita.
   */
  const esOpaco = (color: string): boolean => {
    const sobreBlanco = componer(color, [255, 255, 255]);
    const sobreNegro = componer(color, [0, 0, 0]);
    return sobreBlanco.every((v, i) => v === sobreNegro[i]);
  };

  const fondosDe = (el: Element): number[][] => {
    const capas: string[] = [];
    const gradientes: string[] = [];
    for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      const bi = s.backgroundImage;
      if (bi && bi !== 'none' && bi.includes('gradient')) {
        // Las paradas de color, sin la dirección ni los porcentajes.
        const stops = bi.match(/(?:oklch|oklab|rgba?|hsla?|color)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}/gi);
        if (stops) gradientes.push(...stops);
      }
      const bg = s.backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        capas.push(bg);
        // SE CORTA EN EL PRIMER FONDO OPACO, y esto no es una optimización.
        // Sin el corte, el botón `bg-white text-primary` que va ENCIMA del hero
        // arrastraba las paradas del gradiente de su ancestro y el peor caso
        // daba 1:1 — un falso positivo sobre un botón perfectamente legible. Lo
        // que está detrás de una capa opaca no se ve, y por lo tanto no cuenta.
        if (esOpaco(bg)) return terminar(capas, gradientes);
      }
    }
    capas.push(getComputedStyle(document.documentElement).backgroundColor || 'rgb(255,255,255)');
    return terminar(capas, gradientes);
  };

  function terminar(capas: string[], gradientes: string[]): number[][] {

    let plano: number[] | null = null;
    for (const bg of capas.reverse()) plano = componer(bg, plano);

    // Cada parada se compone sobre el fondo plano: un gradiente puede llevar
    // alfa, y ahí lo que se ve es la mezcla.
    const candidatos = [plano!];
    for (const g of gradientes) {
      // `CSS.supports` Y NO UN try/catch, y la diferencia es todo.
      //
      // Asignar un valor inválido a `canvas.fillStyle` **NO LANZA**: el spec de
      // HTML dice que se ignora y el atributo conserva lo que tenía. Medido —
      // tras asignarle basura, `fillStyle` seguía valiendo `#010203`.
      //
      // Como `componer` pinta `debajo` justo antes, una parada que el regex
      // mutile (el `color-mix(in oklab, …)` que emite Tailwind v4 para
      // `from-primary/80`, por ejemplo) producía un candidato IDÉNTICO al fondo
      // plano: el peor caso nunca se evaluaba y el guard aprobaba. O sea, el
      // mismo falso negativo silencioso que la medición de gradientes vino a
      // cerrar, reintroducido en su propio arreglo.
      //
      // Ahora lo que no se puede medir se DENUNCIA en vez de aprobarse.
      if (CSS.supports('color', g)) candidatos.push(componer(g, plano));
      else noMedibles.push(g.slice(0, 60));
    }
    return candidatos;
  }

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    // `<= 1` y no `< 1`: `sr-only` de Tailwind mide 1x1 px EXACTO y después se
    // clipea a nada. Con `< 1` sobrevivía al filtro, y cualquier texto para
    // lector de pantalla que heredara un color flojo haría fallar el guard por
    // algo que nadie ve. Hoy no hay ninguno en las rutas cubiertas: es latente.
    if (r.width <= 1 || r.height <= 1) return false;
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

    // EL PEOR de los fondos candidatos, no el primero: con un gradiente detrás,
    // "se lee" tiene que valer en toda su extensión, no en la parada que más
    // convenga.
    const candidatos = fondosDe(el);
    let r = Infinity;
    let fondo = candidatos[0];
    for (const c of candidatos) {
      const actual = ratio(componer(s.color, c), c);
      if (actual < r) {
        r = actual;
        fondo = c;
      }
    }

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

  return {
    hallazgos,
    medidos,
    oscuro: document.documentElement.classList.contains('dark'),
    noMedibles: [...new Set(noMedibles)],
  };
}

async function enModoOscuro(page: Page, ruta: Ruta): Promise<Resultado> {
  await page.goto(ruta.path);

  // SIN TRANSICIONES, o se mide un color A MITAD DE CAMINO. Va acá y no en un
  // `beforeEach`, porque un `<style>` inyectado muere con la navegación.
  //
  // Media web lleva `transition-colors`, y `getComputedStyle().color` durante
  // una transición devuelve el valor INTERPOLADO, no el final. Al cambiar el
  // `networkidle` por una espera más temprana esto salió a la luz de golpe: el
  // link inactivo del navbar —`text-gray-600 dark:text-gray-300`, que en reposo
  // da ~9:1— se reportó en **2.35:1**, que es el gris intermedio entre los dos
  // temas. Siete hallazgos fantasma en una sola ruta.
  //
  // `networkidle` lo tapaba por accidente, dando tiempo de sobra. Tapar no es
  // resolver: la medición tiene que ser independiente de CUÁNDO se hace.
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });
  // `networkidle` está desaconsejado por Playwright y en `/map` es directamente
  // el criterio equivocado: Leaflet sigue pidiendo tiles de OSM mientras el
  // viewport se asienta, así que la espera podía comerse el timeout de 30s y
  // teñir de rojo el guard entero por un motivo que no es contraste.
  //
  // Se espera el ancla cuando la hay —que además es la señal de que la lista
  // renderizó— y el `<footer>` cuando no: es lo último del árbol, así que verlo
  // significa que la página está armada.
  if (ruta.ancla) await page.getByText(ruta.ancla(), { exact: false }).first().waitFor({ timeout: 20_000 });
  else await page.locator('footer').first().waitFor({ timeout: 20_000 });

  return page.evaluate(medirContraste);
}

test.describe('contraste WCAG AA en modo oscuro', () => {
  test.beforeAll(async () => {
    // Una mascota y una historia REALES, para que `/` y `/stories` midan
    // tarjetas y no su estado vacío. Ver el docblock de `Ruta.ancla`.
    const email = uniqueEmail();
    const password = 'contrasten4';
    await seedUser(email, password);
    const token = await getToken(email, password);

    nombreMascota = `Contraste-${Date.now()}`;
    const petId = await seedStray(token, nombreMascota);
    await markFound(token, petId);

    tituloHistoria = `Historia de contraste ${Date.now()}`;
    await seedStory(token, petId, tituloHistoria, 'Volvió a casa gracias a la comunidad.');

    // EL CANARIO DEL CANARIO. Si la siembra fallara sin lanzar, estas variables
    // quedarían vacías y `new RegExp('')` MATCHEA CUALQUIER COSA: el ancla
    // pasaría contra una página en blanco y el guard volvería a certificar el
    // estado vacío, que es exactamente lo que el ancla vino a impedir.
    expect(nombreMascota, 'la siembra no dejó nombre de mascota').not.toBe('');
    expect(tituloHistoria, 'la siembra no dejó título de historia').not.toBe('');
  });

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
    test(`${ruta.path} — ningún texto por debajo del umbral`, async ({ page }) => {
      const { hallazgos, medidos, oscuro, noMedibles } = await enModoOscuro(page, ruta);

      // LAS AFIRMACIONES QUE VAN ANTES DEL RESULTADO. Sin ellas, "cero
      // hallazgos" también se emite cuando la app no montó, cuando el tema no se
      // aplicó, o cuando un fondo no se pudo medir — la misma forma que un
      // `curl` sin `--fail`.
      expect(oscuro, `${ruta.path}: la raíz no tiene la clase .dark`).toBe(true);
      expect(medidos, `${ruta.path}: sólo ${medidos} nodos con texto — ¿montó la app?`)
        .toBeGreaterThanOrEqual(CANARIO);
      expect(
        noMedibles,
        `${ruta.path}: hay paradas de gradiente que el navegador no reconoce como ` +
          `color, así que su contraste NO se midió:\n  ${noMedibles.join('\n  ')}\n\n` +
          `Un fondo que no se pudo medir no es un fondo aprobado: arreglá el regex ` +
          `de paradas en fondosDe(), no exentes el caso.`
      ).toEqual([]);

      const detalle = hallazgos
        .map((h) => `  ${h.ratio}:1 < ${h.umbral}  ${h.px}px/${h.peso}  <${h.tag}> "${h.texto}"  [${h.clases}]`)
        .join('\n');

      expect(
        hallazgos,
        `${ruta.path}: ${hallazgos.length} textos por debajo del umbral AA en modo oscuro:\n${detalle}\n\n` +
          `Para texto, en oscuro usá \`dark:text-primary-light\` (el \`primary\` está ` +
          `calibrado para llevar blanco encima, no para SER el texto) y \`dark:text-gray-400\` ` +
          `en vez de \`gray-500\` (el gris del modo oscuro va más CLARO, no más oscuro).`
      ).toEqual([]);
    });
  }
});
