import { test, expect } from '@playwright/test';

test('map page loads tiles', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/map');

  await page.locator('.leaflet-tile').first().waitFor({ state: 'visible', timeout: 15_000 });

  expect(errors).toHaveLength(0);
});
