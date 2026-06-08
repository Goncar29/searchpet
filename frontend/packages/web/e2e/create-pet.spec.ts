import { test, expect } from '@playwright/test';
import { uniqueEmail, seedUser, loginAs } from './helpers';

test.describe('Create pet page', () => {
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    email = uniqueEmail();
    password = 'password123';
    await seedUser(email, password);
  });

  test('authenticated user can create a pet', async ({ page }) => {
    await loginAs(page, email, password);

    await page.goto('/pets/create');

    // Fill name field (id="name")
    await page.locator('#name').fill('PlaywrightPet');

    // Select species (id="type") — use the Spanish value the form uses
    await page.locator('#type').selectOption('perro');

    // Submit the form — use type-based selector to avoid i18n issues
    await page.locator('form button[type="submit"]').click();

    // After creation the app navigates to the pet detail page — assert pet name is visible
    // Use .first() because PdfFlyerButton renders a hidden off-screen h1 with the same text
    await expect(page.getByText('PlaywrightPet').first()).toBeVisible({ timeout: 10_000 });
  });
});
