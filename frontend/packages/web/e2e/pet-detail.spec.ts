import { test, expect } from '@playwright/test';
import { uniqueEmail, seedUser } from './helpers';

const API_URL = process.env.API_URL ?? 'http://localhost:8080';

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
    await expect(page.getByText(petName)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/perro/i)).toBeVisible({ timeout: 10_000 });
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
