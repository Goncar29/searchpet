import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { apiClient } from '@shared/api/client';
import { AbuseReportsPage } from './AbuseReportsPage';

// Mock i18n: t returns the key; when interpolation values are passed, append
// them so tests can still assert the interpolated id/name appears.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

let mockReports: unknown[] = [];
// When set, overrides the reported total so pagination can be exercised
// independently of how many rows the mock returns for the current page.
let mockTotal: number | null = null;
// Qué offsets tienen que fallar. Un booleano suelto no alcanza: el defecto que
// se persigue sólo aparece cuando falla UNA página y no la primera.
let mockFailOffsets: number[] = [];

vi.mock('@shared/api/client', () => ({
  apiClient: {
    listAbuseReports: vi.fn((params?: { offset?: number }) =>
      mockFailOffsets.includes(params?.offset ?? 0)
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: mockReports, total: mockTotal ?? mockReports.length })
    ),
    resolveAbuseReport: vi.fn(() => Promise.resolve({})),
    deleteReport: vi.fn(() => Promise.resolve({ message: 'report deleted' })),
    banUser: vi.fn(() => Promise.resolve({ message: 'user banned' })),
    unbanUser: vi.fn(() => Promise.resolve({ message: 'user unbanned' })),
  },
}));

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    reporter_id: 'rrrrrrrr-0000-0000-0000-000000000000',
    reason: 'spam',
    status: 'pending',
    created_at: '2026-06-20T00:00:00Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AbuseReportsPage', () => {
  beforeEach(() => {
    mockReports = [];
    mockTotal = null;
    mockFailOffsets = [];
    vi.clearAllMocks();
  });

  it('muestra el nombre del reporter como link a su perfil', async () => {
    mockReports = [makeReport({ reporter: { id: 'u-rep', name: 'Alice' } })];
    render(<AbuseReportsPage />, { wrapper });

    const link = await screen.findByRole('link', { name: 'Alice' });
    expect(link.getAttribute('href')).toBe('/users/u-rep');
  });

  it('muestra un target usuario como link a su perfil', async () => {
    mockReports = [
      makeReport({
        reporter: { id: 'u-rep', name: 'Alice' },
        target_user: { id: 'u-bob', name: 'Bob' },
      }),
    ];
    render(<AbuseReportsPage />, { wrapper });

    const link = await screen.findByRole('link', { name: 'Bob' });
    expect(link.getAttribute('href')).toBe('/users/u-bob');
  });

  it('muestra un target reporte como nombre de mascota linkeado a la mascota', async () => {
    mockReports = [
      makeReport({
        reporter: { id: 'u-rep', name: 'Alice' },
        target_report: { id: 'rep-1', pet_id: 'pet-1', pet_name: 'Toby' },
      }),
    ];
    render(<AbuseReportsPage />, { wrapper });

    const link = await screen.findByRole('link', { name: 'Toby' });
    expect(link.getAttribute('href')).toBe('/pets/pet-1');
  });

  it('cae al ID truncado cuando no hay objetos enriquecidos', async () => {
    mockReports = [makeReport({ target_user_id: 'tttttttt-0000-0000-0000-000000000000' })];
    render(<AbuseReportsPage />, { wrapper });

    expect(await screen.findByText(/tttttttt/)).toBeTruthy();
    // reporter falls back to its truncated id (no link)
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('ofrece "Ban" para un target usuario no baneado y llama banUser con la razón al confirmar', async () => {
    mockReports = [
      makeReport({
        reporter: { id: 'u-rep', name: 'Alice' },
        target_user: { id: 'u-bob', name: 'Bob', is_banned: false },
      }),
    ];
    render(<AbuseReportsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'abuse.action.ban' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: 'spam account' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'abuse.modal.banConfirm' }));

    await waitFor(() => expect(apiClient.banUser).toHaveBeenCalledWith('u-bob', 'spam account'));
  });

  // El boton de cancelar de estos modales decia "Cancel" cableado en ingles,
  // porque `ConfirmModal` lo traia como default y esta pagina nunca pasaba
  // `cancelLabel`. Un admin con la app en español leia "Cancel" en los cinco.
  //
  // OJO CON LO QUE AFIRMA ESTE TEST: `t` esta mockeado para devolver la clave,
  // asi que lo unico que puede comprobar es que el texto SALE DE `t` — no que
  // la traduccion exista. Es exactamente la distincion que dejo vivo al bug:
  // "Cancel" no es una clave sin resolver, es una palabra inglesa de verdad, y
  // un barrido de claves crudas la deja pasar limpia.
  it('el boton de cancelar sale de i18n y no de un texto cableado', async () => {
    mockReports = [
      makeReport({
        reporter: { id: 'u-rep', name: 'Alice' },
        target_user: { id: 'u-bob', name: 'Bob', is_banned: false },
      }),
    ];
    render(<AbuseReportsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'abuse.action.ban' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'common:cancel' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('ofrece "Unban" para un target usuario baneado y llama unbanUser al confirmar', async () => {
    mockReports = [
      makeReport({
        reporter: { id: 'u-rep', name: 'Alice' },
        target_user: { id: 'u-bob', name: 'Bob', is_banned: true },
      }),
    ];
    render(<AbuseReportsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'abuse.action.unban' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'abuse.modal.unbanConfirm' }));

    await waitFor(() => expect(apiClient.unbanUser).toHaveBeenCalledWith('u-bob'));
  });

  it('ofrece "Delete content" para un target reporte y llama deleteReport con el id del reporte', async () => {
    mockReports = [
      makeReport({
        reporter: { id: 'u-rep', name: 'Alice' },
        target_report: { id: 'rep-1', pet_id: 'pet-1', pet_name: 'Toby' },
      }),
    ];
    render(<AbuseReportsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'abuse.action.deleteContent' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'abuse.modal.deleteConfirm' }));

    await waitFor(() => expect(apiClient.deleteReport).toHaveBeenCalledWith('rep-1'));
  });

  it('navega a la página siguiente pidiendo el offset correcto', async () => {
    mockReports = [makeReport({ reporter: { id: 'u-rep', name: 'Alice' } })];
    mockTotal = 50; // 3 pages of 20
    render(<AbuseReportsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'next' }));

    await waitFor(() =>
      expect(apiClient.listAbuseReports).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, offset: 20 })
      )
    );
  });

  // ── La cola caída no se puede ver igual que la cola vacía ──

  // Es la versión de más riesgo de todo este trabajo: "No hay denuncias" es lo
  // que hace que un moderador cierre la pestaña. Si en realidad la cola está
  // llena y la consulta falló, nadie modera nada y nadie se entera.
  it('con la consulta caida NO dice que no hay denuncias', async () => {
    mockFailOffsets = [0];
    render(<AbuseReportsPage />, { wrapper });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('abuse.empty')).not.toBeInTheDocument();
  });

  // La otra mitad: sin denuncias de verdad, el texto se queda. Es un hecho.
  it('sin denuncias y sin error, sigue diciendo que no hay', async () => {
    render(<AbuseReportsPage />, { wrapper });

    expect(await screen.findByText('abuse.empty')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // El `useEffect` que acota la página lee `total`, y con la consulta caída
  // `total` es 0 → `totalPages` 1 → devuelve al admin a la página 1. Eso
  // CAMBIA la queryKey, así que arranca otra consulta (la de la página 1, que
  // anda) y **el cartel de error nunca llega a dibujarse**: el porte quedaría
  // anulado en toda página que no sea la primera, en silencio.
  it('una pagina caida NO devuelve al admin a la pagina 1', async () => {
    mockReports = [makeReport({ reporter: { id: 'u-rep', name: 'Alice' } })];
    mockTotal = 50; // 3 páginas
    mockFailOffsets = [20]; // sólo la segunda falla
    render(<AbuseReportsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'next' }));

    // El admin se entera de que la página 2 no cargó...
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // ...y la fila de la página 1 ya no está en pantalla.
    expect(screen.queryByText('Alice')).toBeNull();

    // Y sigue PARADO en la página 2. Eso no se puede leer del DOM —`Pagination`
    // se dibuja dentro de `children`, así que con el cartel en pantalla no
    // existe—, se mide por consecuencia: "Reintentar" refetchea la queryKey
    // ACTUAL, así que el offset del pedido siguiente ES la página en la que
    // quedó.
    //
    // La primera versión de esta aserción era `not.toHaveBeenCalledTimes(3)` y
    // quedaba VERDE contra el código viejo: el rebote a la página 1 reusa la
    // caché de React Query y no genera ningún pedido. Medía algo que no era.
    vi.mocked(apiClient.listAbuseReports).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'common:retry' }));

    await waitFor(() => expect(apiClient.listAbuseReports).toHaveBeenCalled());
    for (const call of vi.mocked(apiClient.listAbuseReports).mock.calls) {
      expect(call[0]).toMatchObject({ offset: 20 });
    }
  });

  // Quedarse en la página 2 es lo correcto, pero sin salida es una trampa: el
  // pager vive DENTRO de `children`, así que con el cartel en pantalla no
  // existe, y "Reintentar" vuelve a pedir la MISMA página que falla. Si la 2
  // falla siempre —una fila rota, un timeout en un offset más pesado— el único
  // escape sería recargar el navegador. Es el defecto del wizard de /publish
  // (regla #51) en otra pantalla: un estado del que no se puede salir.
  it('una pagina caida ofrece una salida a la primera pagina', async () => {
    mockReports = [makeReport({ reporter: { id: 'u-rep', name: 'Alice' } })];
    mockTotal = 50;
    mockFailOffsets = [20];
    render(<AbuseReportsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'next' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // El pager NO está — por eso hace falta esta salida y no alcanza con él.
    expect(screen.queryByRole('button', { name: 'prev' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'backToFirstPage' }));

    // Y la salida LLEVA a algún lado: la página 1 vuelve a estar en pantalla.
    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });

  // La otra mitad: en la página 1 no hay a dónde volver, así que el botón no se
  // dibuja. Un "volver a la primera página" estando en la primera es ruido.
  it('en la pagina 1 caida no ofrece esa salida', async () => {
    mockFailOffsets = [0];
    render(<AbuseReportsPage />, { wrapper });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'backToFirstPage' })).toBeNull();
  });

  it('resetea a la página 1 al cambiar de filtro', async () => {
    mockReports = [makeReport({ reporter: { id: 'u-rep', name: 'Alice' } })];
    mockTotal = 50;
    render(<AbuseReportsPage />, { wrapper });

    // Go to page 2 first.
    fireEvent.click(await screen.findByRole('button', { name: 'next' }));
    await waitFor(() =>
      expect(apiClient.listAbuseReports).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 20 })
      )
    );

    // Switching filter must reset paging back to offset 0.
    fireEvent.click(screen.getByRole('button', { name: 'abuse.filter.pending' }));
    await waitFor(() =>
      expect(apiClient.listAbuseReports).toHaveBeenCalledWith(
        expect.objectContaining({ resolved: false, offset: 0 })
      )
    );
  });
});
