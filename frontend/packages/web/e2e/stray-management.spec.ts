import { test, expect } from '@playwright/test';
import { uniqueEmail, seedUser, loginAs, getToken, seedStray, markFound } from './helpers';

// Smoke tests for the stray-management behaviors shipped in PRs #4/#5:
// a stray's reporter is a first-class manager. Two user-visible guarantees:
//   1. the status dropdown only offers transitions the backend accepts
//      (a stray may only become "found"), and
//   2. once the stray is found, its reporter can tell its success story.
test.describe('Stray management', () => {
  let email: string;
  const password = 'password123';
  let token: string;
  let strayId: string;       // stays "stray" — for the dropdown test
  let foundStrayId: string;  // marked found — for the success-story test

  test.beforeAll(async () => {
    email = uniqueEmail();
    await seedUser(email, password);
    token = await getToken(email, password);
    strayId = await seedStray(token, `Stray-${Date.now()}`);
    foundStrayId = await seedStray(token, `FoundStray-${Date.now()}`);
    await markFound(token, foundStrayId);
  });

  test('stray status dropdown offers only the valid transition (found)', async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/pets/mine');

    // Switch to the "My reports" tab — strays the user reported live here.
    await page.getByRole('button', { name: /mis reportes|my reports|meus relatos/i }).click();

    // The reported stray's card carries the status <select> (targeted by
    // test id so we don't accidentally match the navbar language switcher).
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
    await loginAs(page, email, password);
    await page.goto(`/pets/${foundStrayId}`);

    // canManage (reporter) + status "found" → the "Contar historia" link shows,
    // even though the stray has no owner.
    await expect(
      page.getByRole('link', { name: /contar historia|tell.*story/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
