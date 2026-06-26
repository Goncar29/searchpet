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

vi.mock('@shared/api/client', () => ({
  apiClient: {
    listAbuseReports: () => Promise.resolve(mockReports),
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
});
