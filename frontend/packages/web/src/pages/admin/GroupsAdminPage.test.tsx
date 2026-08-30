import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient, ApiError } from '@shared/api/client';
import { GroupsAdminPage } from './GroupsAdminPage';

// i18next devuelve la clave cuando no hay traducción, y el fallback de
// `getErrorMessage` se apoya EXACTAMENTE en eso. Con una `t` identidad toda
// clave parecería faltante y ningún test podría distinguir el mensaje
// específico del genérico — que es justo la distinción bajo prueba.
const { translations } = vi.hoisted(() => ({ translations: {} as Record<string, string> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      translations[key] ?? (opts ? `${key}:${Object.values(opts).join(',')}` : key),
    i18n: { language: 'es' },
  }),
}));

vi.mock('@shared/api/client', () => ({
  apiClient: { createGroup: vi.fn() },
  // `getErrorMessage` corre `err instanceof ApiError` contra ESTE módulo, así
  // que el mock tiene que exportar una clase de verdad o el chequeo revienta.
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
    }
  },
}));

const mockedApi = vi.mocked(apiClient);

function montar() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupsAdminPage />
    </QueryClientProvider>
  );
}

async function completarYEnviar({ nombre = 'Rescatistas', ciudad = 'Montevideo' } = {}) {
  await userEvent.type(screen.getByLabelText('groups.name'), nombre);
  await userEvent.type(screen.getByLabelText('groups.city'), ciudad);
  await userEvent.click(screen.getByRole('button', { name: 'groups.submit' }));
}

describe('GroupsAdminPage — formulario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(translations)) delete translations[k];
    // Las dos claves existen de verdad en `shared/i18n/locales/*.json:454` y en
    // el namespace `errors`. Que resuelvan a algo distinto de la clave es lo
    // que permite afirmar CUÁL de las dos se mostró.
    translations['errors:city_group_exists'] = 'Ya existe un grupo para esta ciudad';
    translations['errors:unknown_error'] = 'Ocurrió un error inesperado';
    mockedApi.createGroup.mockResolvedValue({
      id: 'g1',
      name: 'Rescatistas',
      city: 'Montevideo',
    } as never);
  });

  // ── Marcado del sistema de formularios ──────────────────────

  // El guard del #185: el asterisco lo dibuja `FormField required` y el JSX
  // traía el suyo. Con los dos, cada campo obligatorio mostraba `**`.
  it('cada campo obligatorio muestra UN solo asterisco', () => {
    montar();

    for (const id of ['group-name', 'group-city']) {
      const fila = document.querySelector(`label[for="${id}"]`)!.parentElement!;
      expect(fila.textContent!.match(/\*/g) ?? []).toHaveLength(1);
    }
  });

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

  it('el hint del campo opcional llega por aria-describedby', () => {
    montar();

    const campo = screen.getByLabelText('groups.description');
    const hintId = campo.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)).toHaveTextContent('groups.optional');
  });

  // Sin tope, una ciudad de más de 100 caracteres revienta el INSERT con
  // SQLSTATE 22001, que el repositorio NO reconoce como duplicado, y el handler
  // contesta 500 `internal`. Los números son los de las columnas.
  it('los topes de largo son los anchos de las columnas', () => {
    montar();

    expect(screen.getByLabelText('groups.name')).toHaveAttribute('maxlength', '255');
    expect(screen.getByLabelText('groups.city')).toHaveAttribute('maxlength', '100');
  });

  // ── Lo que se le dice al usuario ────────────────────────────

  // La región `polite` tiene que estar montada ANTES del envío. Una que se
  // inserta junto con su texto se anuncia de forma poco confiable; `alert`, en
  // cambio, el navegador lo maneja al insertarse, y por eso ese sí es condicional.
  it('la region de estado esta montada y vacia antes de enviar', () => {
    montar();

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // EL HALLAZGO CARO: `city` lleva `uniqueIndex`, así que el backend devuelve
  // 409 `city_group_exists`. Con un texto genérico se le pedía al admin
  // reintentar una operación que NO puede salir bien nunca.
  it('el 409 dice que la ciudad ya tiene grupo, no "intenta de nuevo"', async () => {
    mockedApi.createGroup.mockRejectedValue(new ApiError('city_group_exists', 409, 'conflict'));
    montar();

    await completarYEnviar();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Ya existe un grupo para esta ciudad');
    });
    // La otra mitad: NO cae al mensaje genérico.
    expect(screen.getByRole('alert')).not.toHaveTextContent('Ocurrió un error inesperado');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('un fallo sin codigo conocido cae al mensaje generico', async () => {
    mockedApi.createGroup.mockRejectedValue(new Error('boom'));
    montar();

    await completarYEnviar();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Ocurrió un error inesperado');
    });
  });

  it('el exito se anuncia como status, no como alert', async () => {
    montar();

    await completarYEnviar();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('groups.success');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('groups.name')).toHaveValue('');
  });

  // Vaciar los campos vuelve a deshabilitar el botón, que en ese momento TIENE
  // el foco, y el navegador lo suelta al `<body>`.
  it('tras el exito el foco vuelve al formulario y no al body', async () => {
    montar();

    await completarYEnviar();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('groups.success'));
    expect(document.activeElement).toBe(screen.getByLabelText('groups.name'));
    expect(document.activeElement).not.toBe(document.body);
  });

  // ── Lo que se le manda al backend ───────────────────────────

  // La unicidad de `city` es un índice sobre los BYTES exactos, así que
  // "Montevideo " y "Montevideo" son dos ciudades distintas para la constraint:
  // sin recortar, el 409 del test de arriba se esquiva con un espacio.
  it('recorta nombre y ciudad antes de mandarlos', async () => {
    montar();

    await completarYEnviar({ nombre: '  Rescatistas  ', ciudad: '  Montevideo  ' });

    await waitFor(() => expect(mockedApi.createGroup).toHaveBeenCalledTimes(1));
    expect(mockedApi.createGroup).toHaveBeenCalledWith({
      name: 'Rescatistas',
      city: 'Montevideo',
    });
  });

  it('una descripcion en blanco se OMITE del payload, no viaja como ""', async () => {
    montar();

    await userEvent.type(screen.getByLabelText('groups.description'), '   ');
    await completarYEnviar();

    await waitFor(() => expect(mockedApi.createGroup).toHaveBeenCalledTimes(1));
    expect(mockedApi.createGroup.mock.calls[0][0]).not.toHaveProperty('description');
  });

  it('una descripcion con texto viaja recortada', async () => {
    montar();

    await userEvent.type(screen.getByLabelText('groups.description'), '  Grupo del barrio  ');
    await completarYEnviar();

    await waitFor(() => expect(mockedApi.createGroup).toHaveBeenCalledTimes(1));
    expect(mockedApi.createGroup).toHaveBeenCalledWith({
      name: 'Rescatistas',
      city: 'Montevideo',
      description: 'Grupo del barrio',
    });
  });
});
