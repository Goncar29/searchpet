import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AbuseReportsPage } from './AbuseReportsPage';

let mockReports: unknown[] = [];

vi.mock('@shared/api/client', () => ({
  apiClient: {
    listAbuseReports: () => Promise.resolve(mockReports),
    resolveAbuseReport: vi.fn(),
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

    expect(await screen.findByText(/user: tttttttt/)).toBeTruthy();
    // reporter falls back to its truncated id (no link)
    expect(screen.queryByRole('link')).toBeNull();
  });
});
