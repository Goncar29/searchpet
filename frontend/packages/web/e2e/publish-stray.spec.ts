import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { uniqueEmail, seedUser, loginAs, getToken, seedStray } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Publish stray flow', () => {
  let email: string;
  let password: string;
  let vecinoID: string;

  test.beforeAll(async () => {
    email = uniqueEmail();
    password = 'password123';
    await seedUser(email, password);

    // Un callejero YA REGISTRADO en el mismo punto que el pin por defecto del
    // wizard (`seedStray` siembra en Montevideo, igual que el mapa). Sin esto
    // el paso de candidatos aparecía o no según qué otro spec hubiera corrido
    // antes en la base compartida — o sea que el flujo probado dependía del
    // orden entre workers. Sembrarlo acá lo vuelve una precondición declarada.
    const token = await getToken(email, password);
    vecinoID = await seedStray(token, `Vecino-${Date.now()}`);
  });

  // Llega hasta el paso de candidatos con el borrador mínimo cargado.
  async function hastaCandidatos(page: import('@playwright/test').Page) {
    await loginAs(page, email, password);
    await page.goto('/publish');
    await page.getByTestId('intent-stray').click();
    await page
      .getByTestId('stray-photo-input')
      .setInputFiles(path.join(__dirname, 'fixtures', 'stray.png'));
    await page.getByTestId('stray-type-select').selectOption('perro');
    await page.getByRole('button', { name: /continuar|continue/i }).click();
    // Paso de ubicación: el pin por defecto de Montevideo alcanza.
    await page.getByRole('button', { name: /publicar|publish/i }).click();
    await expect(page.getByTestId('candidates-step')).toBeVisible({ timeout: 15_000 });
  }

  test('authenticated user publishes a stray sighting end to end', async ({ page }) => {
    await hastaCandidatos(page);

    // El callejero sembrado está en el MISMO punto, así que tiene que estar.
    await expect(page.locator(`[data-pet-id="${vecinoID}"]`)).toBeVisible();

    // "Ninguno, es otro animal": el alta sigue.
    await page.getByTestId('candidates-skip').click();

    await expect(page.getByTestId('publish-success')).toBeVisible({ timeout: 10_000 });
  });

  // La mitad que evita el duplicado: reconocer al animal deriva al reporte
  // sobre la ficha que ya existe, y NO crea una segunda mascota.
  test('picking a candidate reports on the existing pet instead of creating one', async ({ page }) => {
    await hastaCandidatos(page);

    await page.locator(`[data-pet-id="${vecinoID}"]`).getByTestId('candidate-select').click();

    await page.waitForURL(/\/reports\/create\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('petId')).toBe(vecinoID);
    expect(url.searchParams.get('status')).toBe('sighting');
    // No llegó a la pantalla de éxito del alta: no se publicó nada nuevo.
    await expect(page.getByTestId('publish-success')).toHaveCount(0);
  });
});
