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
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill('wrongpassword');
    await page.locator('form button[type="submit"]').click();

    // Error message should appear — does not redirect
    await expect(page).not.toHaveURL('/');
    await expect(page.locator('[class*="red"]').first()).toBeVisible();
  });
});
