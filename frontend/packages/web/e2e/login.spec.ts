import { test, expect } from '@playwright/test';
import { uniqueEmail, seedUser, loginAs } from './helpers';

test.describe('Login page', () => {
  test('valid login redirects to home', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'password123';
    await seedUser(email, password);
    await loginAs(page, email, password);
    await expect(page).toHaveURL('/');
  });

  test('wrong password shows error', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'password123';
    await seedUser(email, password);

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password|contraseña/i).fill('wrongpassword');
    await page.getByRole('button', { name: /login|iniciar/i }).click();

    // Error message should appear — does not redirect
    await expect(page).not.toHaveURL('/');
    await expect(page.locator('[class*="red"]').first()).toBeVisible();
  });
});
