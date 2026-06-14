import { test, expect } from '@playwright/test';
import { uniqueEmail, seedUser, loginAs, getToken, seedStray, markFound } from './helpers';

// Smoke tests for the stray-management behaviors shipped in PRs #4/#5:
// a stray's reporter is a first-class manager. Two user-visible guarantees:
//   1. the status dropdown only offers transitions the backend accepts
//      (a stray may only become "found"), and
//   2. once the stray is found, its reporter can tell its success story.
//
// Each test uses its OWN reporter so the "My reports" tab holds exactly one
// pet — keeping the dropdown assertion unambiguous.
test.describe('Stray management', () => {
  const password = 'password123';

  // Reporter A — owns a single still-stray report (dropdown test).
  let emailA: string;
  let strayId: string;

  // Reporter B — owns a single report that has been marked found (story test).
  let emailB: string;
  let foundStrayId: string;

  test.beforeAll(async () => {
    emailA = uniqueEmail();
    await seedUser(emailA, password);
    const tokenA = await getToken(emailA, password);
    strayId = await seedStray(tokenA, `Stray-${Date.now()}`);

    emailB = `b-${uniqueEmail()}`;
    await seedUser(emailB, password);
    const tokenB = await getToken(emailB, password);
    foundStrayId = await seedStray(tokenB, `FoundStray-${Date.now()}`);
    await markFound(tokenB, foundStrayId);
  });

  test('stray status dropdown offers only the valid transition (found)', async ({ page }) => {
    await loginAs(page, emailA, password);
    await page.goto('/pets/mine');

    // Switch to the "My reports" tab — strays the user reported live here.
    await page.getByRole('button', { name: /mis reportes|my reports|meus relatos/i }).click();

    // The reported stray's card carries the status <select> (targeted by test id
    // so we don't match the navbar language switcher). Reporter A has exactly
    // one reported pet, so .first() is unambiguous.
    const statusSelect = page.getByTestId('status-select').first();
    await expect(statusSelect).toBeVisible({ timeout: 10_000 });

    const optionValues = await statusSelect
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));

    // Only the current status plus its single valid target — never lost /
    // registered / archived, which the backend would reject with 422.
    expect(optionValues).toEqual(['stray', 'found']);
  });

  test('reporter can tell the success story once the stray is found', async ({ page }) => {
    await loginAs(page, emailB, password);
    await page.goto(`/pets/${foundStrayId}`);

    // canManage (reporter) + status "found" → the "Contar historia" link shows,
    // even though the stray has no owner.
    await expect(
      page.getByRole('link', { name: /contar historia|tell.*story/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
