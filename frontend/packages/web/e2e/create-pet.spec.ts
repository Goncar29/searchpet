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

    // Submit the form
    await page.getByRole('button', { name: /publicar|crear|registrar|submit/i }).click();

    // After creation the app navigates to the pet detail page — assert pet name is visible
    await expect(page.getByText('PlaywrightPet')).toBeVisible({ timeout: 10_000 });
  });
});
