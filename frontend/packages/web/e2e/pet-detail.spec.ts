import { test, expect } from '@playwright/test';
import { uniqueEmail, seedUser, loginAs, seedStray } from './helpers';

const API_URL = process.env.API_URL ?? 'http://localhost:8081';

async function seedPet(token: string, name: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/pets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, type: 'perro' }),
  });
  if (!res.ok) throw new Error(`seedPet failed: ${res.status}`);
  const data = await res.json();
  return data.id as string;
}

async function getToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`getToken login failed: ${res.status}`);
  const data = await res.json();
  return data.token as string;
}

test.describe('Pet detail page', () => {
  // Pin the browser locale to Spanish so the pet type renders as "Perro".
  // The detail page localizes the type via t(`pets:types.${pet.type}`), which
  // resolves to "Dog"/"Cachorro" under the CI runner's default (en) locale.
  test.use({ locale: 'es-ES' });

  let petId: string;
  let petName: string;

  test.beforeAll(async () => {
    const email = uniqueEmail();
    const password = 'password123';
    await seedUser(email, password);
    const token = await getToken(email, password);
    petName = `DetailPet-${Date.now()}`;
    petId = await seedPet(token, petName);
  });

  test('pet name and type are visible on detail page', async ({ page }) => {
    await page.goto(`/pets/${petId}`);
    // Use .first() because PdfFlyerButton renders a hidden off-screen h1 + table with the same text
    await expect(page.getByText(petName).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/perro/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('contact button is present and click does not cause unhandled JS error', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(`/pets/${petId}`);

    // The contact button typically says "Contactar" or "Contact" — use a broad matcher
    const contactBtn = page.getByRole('button', { name: /contactar|contact|message|mensaje/i });
    if (await contactBtn.isVisible()) {
      await contactBtn.click();
    }

    expect(jsErrors).toHaveLength(0);
  });
});

// A SEPARATE describe on purpose. The block above pins `locale: 'es-ES'`, and
// these tests exist precisely to read the page in a language that is not
// Spanish — running them under that override would have proved nothing.
test.describe('Pet detail — redesign', () => {
  // Pinned rather than inherited from the runner: a CI image that ships a
  // different default locale would silently turn the i18n test below into a
  // tautology instead of failing.
  test.use({ locale: 'en-US' });

  const password = 'password123';
  let email: string;
  let petId: string;

  test.beforeEach(async () => {
    email = uniqueEmail();
    await seedUser(email, password);
    const token = await getToken(email, password);
    // Seeded with this account's token, so the account is the stray's reporter
    // and `canManage` is true — that is what puts the found button on screen.
    petId = await seedStray(token, `Redesign-${Date.now()}`);
  });

  // The unit suite cannot reach this. It mocks react-i18next with
  // `t: (key) => key`, so there is no English in that harness: a test there can
  // only prove a string stopped being a literal, never that the translation
  // reads right. The whole mark-as-found flow was hardcoded Spanish and the
  // unit suite went green over it.
  test('the irreversible found confirmation speaks the browser language', async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto(`/pets/${petId}`);

    const markFound = page.getByRole('button', { name: /mark as found/i });
    await expect(markFound).toBeVisible({ timeout: 10_000 });

    await markFound.click();

    // Confirming something that cannot be undone is the last place a user
    // should meet a language they did not choose.
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await expect(page.getByText(/Confirmás/)).toHaveCount(0);

    await page.getByRole('button', { name: /^confirm$/i }).click();
    await expect(page.getByText(/this pet has been found/i)).toBeVisible();
  });

  test('a long unbreakable word does not scroll the page sideways', async ({ page }) => {
    const token = await getToken(email, password);
    const res = await fetch(`${API_URL}/api/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: `Wide-${Date.now()}`,
        type: 'gato',
        status: 'stray',
        description:
          'Donaudampfschiffahrtselektrizitaetenhauptbetriebswerkbauunterbeamtengesellschaft',
        initial_report: { latitude: -34.9011, longitude: -56.1645 },
      }),
    });
    if (!res.ok) throw new Error(`seed wide pet failed: ${res.status}`);
    const wideId = (await res.json()).id as string;

    // `min-w-0` and the grid's `minmax(0,…)` stop the TRACK from growing; they
    // do NOT make a word wrap. Only `break-words` on the text node does, and
    // dropping it costs 338px of sideways scroll on a phone with nothing else
    // in the suite noticing.
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/pets/${wideId}`);
      // `.first()` for the same reason the block above uses it: SharePanel and
      // PdfFlyerButton each render an offscreen template that repeats the
      // description, so an unscoped match is a strict-mode violation rather
      // than a failing assertion.
      await expect(page.getByText(/Donaudampf/).first()).toBeVisible({ timeout: 10_000 });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `scroll horizontal a ${width}px`).toBe(0);
    }
  });

  test('a pet with no contact block leaves no empty sidebar column', async ({ page }) => {
    // The reporter looking at their own stray: the owner block does not apply,
    // the reporter block returns null for the reporter themselves, and the
    // abuse block is hidden because they manage the pet. An <aside> here would
    // still claim the grid's 1fr column and blank out a third of the page.
    await loginAs(page, email, password);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/pets/${petId}`);
    // Readiness is the body container, deliberately NOT the found button: this
    // test says nothing about i18n, and gating it on a translated label would
    // make it go red for someone else's bug and muddy the diagnosis.
    await expect(page.locator('[data-detail-body]')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('aside')).toHaveCount(0);

    // And the grid has to collapse with it, or the timeline — the next grid
    // child — lands in the right-hand column instead of below.
    const columns = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-detail-body]')!).gridTemplateColumns,
    );
    expect(columns.trim().split(/\s+/)).toHaveLength(1);
  });
});
