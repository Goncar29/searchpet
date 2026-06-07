import { Page } from '@playwright/test';

const API_URL = process.env.API_URL ?? 'http://localhost:8080';

export function uniqueEmail(): string {
  return `test-${Date.now()}@searchpet.test`;
}

export async function seedUser(email: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Test User' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`seed failed: ${res.status} — ${text}`);
  }
}

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL('/');
}
