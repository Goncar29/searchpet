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
