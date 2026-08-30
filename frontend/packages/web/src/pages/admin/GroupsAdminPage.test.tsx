import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import { GroupsAdminPage } from './GroupsAdminPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

let falla = false;

vi.mock('@shared/api/client', () => ({
  apiClient: {
    createGroup: vi.fn(() =>
      falla
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ id: 'g1', name: 'Rescatistas', city: 'Montevideo' })
    ),
  },
}));

function montar() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupsAdminPage />
    </QueryClientProvider>
  );
}

describe('GroupsAdminPage — formulario', () => {
  beforeEach(() => {
    falla = false;
    vi.mocked(apiClient.createGroup).mockClear();
  });

  // El guard del #185: el asterisco lo dibuja `FormField required` y el JSX
  // traía el suyo. Con los dos, cada campo obligatorio mostraba `**`. Se cuenta
  // sobre la fila de la etiqueta, que es donde viven los dos.
  it('cada campo obligatorio muestra UN solo asterisco', () => {
    montar();

    for (const id of ['group-name', 'group-city']) {
      const fila = document.querySelector(`label[for="${id}"]`)!.parentElement!;
      expect(fila.textContent!.match(/\*/g) ?? []).toHaveLength(1);
    }
  });

  // La otra mitad: el campo opcional no debe traer ninguno.
  it('el campo opcional no lleva asterisco', () => {
    montar();

    const fila = document.querySelector('label[for="group-description"]')!.parentElement!;
    expect(fila.textContent).not.toContain('*');
  });

  it('la obligatoriedad tambien viaja por aria-required', () => {
    montar();

    expect(screen.getByLabelText('groups.name')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText('groups.city')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText('groups.description')).not.toHaveAttribute('aria-required');
  });

  // El "(opcional)" vive en un `<span>` hermano del `<label>`, así que sin
  // `aria-describedby` la pista queda sólo para quien mira.
  it('el hint del campo opcional llega por aria-describedby', () => {
    montar();

    const campo = screen.getByLabelText('groups.description');
    const hintId = campo.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)).toHaveTextContent('groups.optional');
  });

  // Los dos avisos eran `<p>` mudos: quien no mira la pantalla enviaba el
  // formulario y no recibia nada. `alert` interrumpe, `status` espera.
  it('el fallo se anuncia como alert', async () => {
    falla = true;
    montar();

    await userEvent.type(screen.getByLabelText('groups.name'), 'Rescatistas');
    await userEvent.type(screen.getByLabelText('groups.city'), 'Montevideo');
    await userEvent.click(screen.getByRole('button', { name: 'groups.submit' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('groups.error');
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('el exito se anuncia como status, no como alert', async () => {
    montar();

    await userEvent.type(screen.getByLabelText('groups.name'), 'Rescatistas');
    await userEvent.type(screen.getByLabelText('groups.city'), 'Montevideo');
    await userEvent.click(screen.getByRole('button', { name: 'groups.submit' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('groups.success');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Y el formulario queda limpio para el siguiente grupo.
    expect(screen.getByLabelText('groups.name')).toHaveValue('');
  });
});
