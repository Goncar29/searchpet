import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import { StoriesAdminPage } from './StoriesAdminPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

let mockStories: unknown[] = [];
// Cuántas historias dice el backend que hay, para poder ejercitar la paginación
// sin devolver 40 filas.
let mockTotal: number | null = null;
// Qué offsets fallan. Un booleano suelto no alcanza: el defecto de la página
// acotada sólo aparece cuando falla UNA página que no es la primera.
let mockFailOffsets: number[] = [];

vi.mock('@shared/api/client', () => ({
  apiClient: {
    getStoriesAdmin: vi.fn((params?: { offset?: number }) =>
      mockFailOffsets.includes(params?.offset ?? 0)
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: mockStories, total: mockTotal ?? mockStories.length }),
    ),
    setStoryFeatured: vi.fn(() => Promise.resolve({})),
    adminDeleteStory: vi.fn(() => Promise.resolve({})),
  },
}));

function story(overrides: Record<string, unknown> = {}) {
  return {
    id: 'st-1',
    title: 'Bruno volvió a casa',
    pet_name: 'Bruno',
    user_name: 'Carlos',
    featured: false,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <StoriesAdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StoriesAdminPage', () => {
  beforeEach(() => {
    mockStories = [];
    mockTotal = null;
    mockFailOffsets = [];
    vi.clearAllMocks();
  });

  it('lista las historias que devuelve el backend', async () => {
    mockStories = [story({})];
    renderPage();

    expect(await screen.findByText('Bruno volvió a casa')).toBeInTheDocument();
  });

  // ── La lista caída no se puede ver igual que la lista vacía ──

  it('con la consulta caida NO dice que no hay historias', async () => {
    mockFailOffsets = [0];
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('stories.empty')).not.toBeInTheDocument();
  });

  // La otra mitad: sin historias de verdad, el texto se queda. Es un hecho.
  it('sin historias y sin error, sigue diciendo que no hay', async () => {
    renderPage();

    expect(await screen.findByText('stories.empty')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // El `useEffect` que acota la página lee `total`, y con la consulta caída
  // `total` es 0 → `totalPages` 1 → devuelve al admin a la página 1. Eso CAMBIA
  // la queryKey, arranca otra consulta y **el cartel de error nunca se dibuja**:
  // el porte quedaría anulado en toda página que no sea la primera.
  it('una pagina caida NO devuelve al admin a la pagina 1', async () => {
    mockStories = [story({})];
    mockTotal = 50; // 3 páginas
    mockFailOffsets = [20]; // sólo la segunda falla
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'next' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Bruno volvió a casa')).toBeNull();

    // Sigue PARADO en la página 2, medido por consecuencia: "Reintentar"
    // refetchea la queryKey ACTUAL, así que el offset del pedido siguiente ES
    // la página en la que quedó. Un `not.toHaveBeenCalledTimes(3)` acá queda
    // verde contra el código viejo, porque el rebote a la página 1 reusa la
    // caché de React Query sin pedir nada.
    vi.mocked(apiClient.getStoriesAdmin).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'common:retry' }));

    await waitFor(() => expect(apiClient.getStoriesAdmin).toHaveBeenCalled());
    for (const call of vi.mocked(apiClient.getStoriesAdmin).mock.calls) {
      expect(call[0]).toMatchObject({ offset: 20 });
    }
  });

  // Quedarse en la página 2 es lo correcto, pero sin salida es una trampa: el
  // pager vive DENTRO de `children`, así que con el cartel en pantalla no
  // existe, y "Reintentar" vuelve a pedir la MISMA página que falla. Esta
  // pantalla NO tiene pestañas de filtro, así que —a diferencia de las
  // denuncias— no hay ningún otro control que resetee la página: el único
  // escape sería recargar el navegador.
  it('una pagina caida ofrece una salida a la primera pagina', async () => {
    mockStories = [story({})];
    mockTotal = 50;
    mockFailOffsets = [20];
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'next' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // El pager NO está — por eso hace falta esta salida y no alcanza con él.
    expect(screen.queryByRole('button', { name: 'prev' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'backToFirstPage' }));

    expect(await screen.findByText('Bruno volvió a casa')).toBeInTheDocument();
  });

  // La otra mitad: en la página 1 no hay a dónde volver.
  it('en la pagina 1 caida no ofrece esa salida', async () => {
    mockFailOffsets = [0];
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'backToFirstPage' })).toBeNull();
  });
});
