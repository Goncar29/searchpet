import { Page } from '@playwright/test';

const API_URL = process.env.API_URL ?? 'http://localhost:8081';

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

export async function getToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`getToken login failed: ${res.status}`);
  const data = await res.json();
  return data.token as string;
}

// Seeds a stray pet (no owner; the caller becomes its reporter) with the
// required initial sighting report. Returns the new pet id.
export async function seedStray(token: string, name: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/pets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name,
      type: 'perro',
      status: 'stray',
      initial_report: { latitude: -34.9011, longitude: -56.1645 },
    }),
  });
  if (!res.ok) throw new Error(`seedStray failed: ${res.status} — ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

export async function markFound(token: string, petId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/pets/${petId}/found`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`markFound failed: ${res.status} — ${await res.text()}`);
}

// Creates a success story for a found pet (caller must be its owner/reporter).
// Returns the new story id.
export async function seedStory(
  token: string,
  petId: string,
  title: string,
  body: string,
): Promise<string> {
  const res = await fetch(`${API_URL}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pet_id: petId, title, body }),
  });
  if (!res.ok) throw new Error(`seedStory failed: ${res.status} — ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}
