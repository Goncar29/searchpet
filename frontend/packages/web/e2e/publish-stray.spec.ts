import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { uniqueEmail, seedUser, loginAs } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Publish stray flow', () => {
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    email = uniqueEmail();
    password = 'password123';
    await seedUser(email, password);
  });

  test('authenticated user publishes a stray sighting end to end', async ({ page }) => {
    await loginAs(page, email, password);

    await page.goto('/publish');

    // Step 1: pick the stray intent.
    await page.getByTestId('intent-stray').click();

    // Step 2: minimal stray form — photo + type are the only required fields.
    await page.getByTestId('stray-photo-input').setInputFiles(path.join(__dirname, 'fixtures', 'stray.png'));
    await page.getByTestId('stray-type-select').selectOption('perro');
    await page.getByRole('button', { name: /continuar|continue/i }).click();

    // Step 3: location step — the default Montevideo pin is enough, just publish.
    await page.getByRole('button', { name: /publicar|publish/i }).click();

    // Step 4: success step.
    await expect(page.getByTestId('publish-success')).toBeVisible({ timeout: 10_000 });
  });
});
