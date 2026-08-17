import { test, expect, type Page } from '@playwright/test';

/**
 * Estas dos cosas NO las puede cazar un test de vitest: jsdom no evalúa media
 * queries ni calcula posiciones, así que `sm:hidden` y `order-*` le son
 * invisibles. Las dos fallaron de verdad durante este rediseño —
 *
 *   1. los logros de las filas estaban en `hidden sm:flex` y desaparecían
 *      enteros abajo de 640px, o sea en el teléfono, que es el caso de uso
 *      principal del proyecto;
 *   2. el podio estaba escrito en orden visual, así que el DOM leía 2-1-3 y el
 *      teclado recorría al segundo antes que al primero.
 *
 * — y las dos se veían perfectas en los tests unitarios.
 */

/**
 * El idioma se FIJA. La app lo detecta de `navigator.language`, así que sin
 * esto el spec depende del locale de la máquina que lo corre: pasaba local (es)
 * y habría fallado en CI (ubuntu, en-US) buscando un botón "Buscar" que allá
 * dice "Search". Un test que depende del entorno del runner no prueba el
 * código, prueba dónde corriste.
 */
test.use({ locale: 'es-UY' });

const BADGES = [
  'first_helper',
  'pet_rescuer',
  'social_butterfly',
  'verified_finder',
  'community_guardian',
  'super_finder',
];

/** Todos con los seis logros, para que las filas tengan que resumir en "+N". */
const entry = (rank: number) => ({
  user_id: `u${rank}`,
  name: `Persona ${rank}`,
  city: 'Montevideo',
  total_points: 200 - rank * 13,
  rank,
  badges: BADGES,
});

/**
 * El podio y las filas comparten el formato del nombre accesible
 * ("Puesto N: Nombre, X pts"), así que se distinguen por el número: el podio es
 * 1-2-3 y las filas arrancan en 4.
 */
const podium = (page: Page) =>
  page.locator('[aria-label^="Puesto 1:"], [aria-label^="Puesto 2:"], [aria-label^="Puesto 3:"]');

async function openLeaderboard(page: Page) {
  await page.route('**/api/stats', (r) =>
    r.fulfill({ json: { pets_reunited: 128, total_users: 940 } }),
  );
  await page.route('**/api/leaderboard*', (r) =>
    r.fulfill({ json: [1, 2, 3, 4, 5, 6].map(entry) }),
  );

  await page.goto('/leaderboard');
  // Selectores estructurales para llegar al formulario: lo que se está
  // probando es el ranking, no el copy del buscador.
  await page.locator('form input[type="text"]').fill('Montevideo');
  await page.locator('form button[type="submit"]').click();
  await page.locator('[aria-label^="Puesto 4"]').first().waitFor({ state: 'visible' });
}

test('en celular las filas conservan sus logros', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeaderboard(page);

  const row = page.locator('[aria-label^="Puesto 4"]').first();
  // Visibles de verdad, no solo presentes en el DOM: `hidden` los dejaba en el
  // markup y esta aserción es la que lo distingue.
  await expect(row.locator('[role="img"]').first()).toBeVisible();
  // Cuatro nodos: los tres logros más el resumen, que también es `role="img"`
  // porque `aria-label` en un elemento genérico no llega al árbol.
  await expect(row.locator('[role="img"]')).toHaveCount(4);
  await expect(row.locator('[role="img"][aria-label*="logros"]')).toHaveCount(1);
  await expect(row.getByText('+3')).toBeVisible();
});

test('el podio se ve 2-1-3 pero el DOM lee 1-2-3', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLeaderboard(page);

  const places = podium(page);
  await expect(places).toHaveCount(3);

  const boxes = await places.evaluateAll((els) =>
    els.map((e) => ({
      place: e.getAttribute('aria-label')!.match(/Puesto (\d)/)![1],
      x: e.getBoundingClientRect().x,
    })),
  );

  // El DOM es el orden que recorren el teclado y un lector de pantalla.
  expect(boxes.map((b) => b.place)).toEqual(['1', '2', '3']);
  // Lo visual lo pone el CSS, no el markup.
  expect([...boxes].sort((a, b) => a.x - b.x).map((b) => b.place)).toEqual(['2', '1', '3']);
});

test('en celular el ganador va arriba de todo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeaderboard(page);

  const places = podium(page);
  const ys = await places.evaluateAll((els) =>
    els.map((e) => ({
      place: e.getAttribute('aria-label')!.match(/Puesto (\d)/)![1],
      y: e.getBoundingClientRect().y,
    })),
  );

  // Apilado, el 2-1-3 de escritorio dejaría al segundo arriba del ganador.
  expect(ys.sort((a, b) => a.y - b.y).map((p) => p.place)).toEqual(['1', '2', '3']);
});

test('el esqueleto deja el podio donde va a aterrizar', async ({ page }) => {
  // Igualar el ALTO no alcanza: el placeholder grande estaba en la columna 1 y
  // el primer puesto aterrizaba en la 2, así que al llegar los datos el avatar
  // se corría 272px de golpe — medido. Un salto horizontal es tan salto como
  // uno vertical, y este lo hacía el esqueleto que existe para evitarlo.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/stats', (r) =>
    r.fulfill({ json: { pets_reunited: 128, total_users: 940 } }),
  );
  await page.route('**/api/leaderboard*', async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.fulfill({ json: [1, 2, 3, 4].map(entry) });
  });

  await page.goto('/leaderboard');
  await page.locator('form input[type="text"]').fill('Montevideo');
  await page.locator('form button[type="submit"]').click();

  // El placeholder más alto del esqueleto del podio.
  await page.locator('.animate-pulse').first().waitFor({ state: 'visible' });
  const xEsqueleto = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.animate-pulse')].filter((e) =>
      e.querySelector('.rounded-full'),
    );
    const alto = items.map((e) => ({
      x: Math.round(e.getBoundingClientRect().x),
      h: Math.round(e.querySelector('.rounded-full')!.getBoundingClientRect().height),
    }));
    return alto.reduce((a, c) => (c.h > a.h ? c : a)).x;
  });

  await page.locator('[aria-label^="Puesto 1:"]').waitFor({ state: 'visible' });
  const xReal = await page
    .locator('[aria-label^="Puesto 1:"]')
    .evaluate((e) => Math.round(e.getBoundingClientRect().x));

  expect(xReal).toBe(xEsqueleto);
});

test('el puntaje del primer puesto llega a 4.5:1 sobre el color de marca', async ({ page }) => {
  // Va en el e2e y no en vitest por dos motivos, y el segundo es el que manda:
  // jsdom no computa colores, y acá se mide el color RENDERIZADO en vez de
  // parsear el CSS — si mañana el token cambia, o alguien suaviza el texto, o
  // una regla de más pisa el color, este test lo ve.
  //
  // Es el dato central del podio. Medido: blanco pleno da 4.77:1 sobre
  // #C24E1A y al 80% cae a 3.63:1, debajo del 4.5:1 de WCAG AA.
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLeaderboard(page);

  const ratio = await page
    .locator('[aria-label^="Puesto 1:"]')
    .evaluate((place) => {
      const parse = (c: string) =>
        c.match(/[\d.]+/g)!.map(Number) as [number, number, number, number?];
      const puntaje = [...place.querySelectorAll('p')].find((p) => /\d+\s/.test(p.textContent || ''))!;
      const [fr, fg, fb, alfa = 1] = parse(getComputedStyle(puntaje).color);

      // El fondo pintado más cercano hacia arriba.
      let node: HTMLElement | null = puntaje;
      let fondo: [number, number, number] = [255, 255, 255];
      while (node) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if ((bg[3] ?? 1) > 0) {
          fondo = [bg[0], bg[1], bg[2]];
          break;
        }
        node = node.parentElement;
      }

      const compuesto = [fr, fg, fb].map((v, i) => v * alfa + fondo[i] * (1 - alfa));
      const lum = (rgb: number[]) => {
        const s = rgb.map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
      };
      const [hi, lo] = [lum(compuesto), lum(fondo)].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    });

  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
