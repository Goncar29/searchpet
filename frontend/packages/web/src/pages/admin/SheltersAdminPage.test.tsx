import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import { SheltersAdminPage } from './SheltersAdminPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/api/client', () => ({
  apiClient: {
    getPendingShelters: vi.fn(),
    approveShelter: vi.fn(),
    rejectShelter: vi.fn(),
    approveShelterLinks: vi.fn(),
    rejectShelterLinks: vi.fn(),
  },
}));

const mockedApi = vi.mocked(apiClient);

const pendingShelter = {
  id: 'sh-1',
  name: 'Refugio Nuevo',
  city: 'Montevideo',
  phone: '099123456',
  email: 'nuevo@test.org',
  website_url: 'https://nuevo.org',
  donation_url: 'https://nuevo.org/donar',
  description: 'Un refugio nuevo',
  is_verified: false,
  created_at: '2026-07-12T00:00:00Z',
  status: 'pending' as const,
  owner_user_id: 'u-1',
};

const linkChangeShelter = {
  ...pendingShelter,
  id: 'sh-2',
  name: 'Refugio Con Cambio',
  status: 'approved' as const,
  // Distinct current URL so the diff's "current" doesn't collide with sh-1's donation link.
  donation_url: 'https://viejo.org/donar',
  pending_donation_url: 'https://cambiado.org/donar',
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SheltersAdminPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SheltersAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getPendingShelters.mockResolvedValue([pendingShelter, linkChangeShelter]);
    mockedApi.approveShelter.mockResolvedValue({ ...pendingShelter, status: 'approved' });
    mockedApi.rejectShelter.mockResolvedValue({ ...pendingShelter, status: 'rejected' });
    mockedApi.approveShelterLinks.mockResolvedValue(linkChangeShelter);
    mockedApi.rejectShelterLinks.mockResolvedValue(linkChangeShelter);
  });

  it('renders both card kinds: new registration and link change with old → new diff', async () => {
    renderPage();
    expect(await screen.findByText('Refugio Nuevo')).toBeTruthy();
    expect(screen.getByText('Refugio Con Cambio')).toBeTruthy();
    expect(screen.getByText('admin:sheltersQueue.newRegistration')).toBeTruthy();
    expect(screen.getByText('admin:sheltersQueue.linkChange')).toBeTruthy();
    // Link diff shows current AND proposed donation URLs.
    expect(screen.getByText('https://nuevo.org/donar')).toBeTruthy();
    expect(screen.getByText('https://cambiado.org/donar')).toBeTruthy();
  });

  it('approve calls the API', async () => {
    renderPage();
    await screen.findByText('Refugio Nuevo');
    fireEvent.click(screen.getByText('admin:sheltersQueue.approve'));
    await waitFor(() => expect(mockedApi.approveShelter).toHaveBeenCalledWith('sh-1'));
  });

  it('reject requires a reason before confirming', async () => {
    renderPage();
    await screen.findByText('Refugio Nuevo');
    fireEvent.click(screen.getByText('admin:sheltersQueue.reject'));

    const confirm = screen.getByText('admin:sheltersQueue.confirmReject') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(mockedApi.rejectShelter).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('admin:sheltersQueue.reasonLabel'), {
      target: { value: 'link de donación sospechoso' },
    });
    fireEvent.click(screen.getByText('admin:sheltersQueue.confirmReject'));
    await waitFor(() =>
      expect(mockedApi.rejectShelter).toHaveBeenCalledWith('sh-1', 'link de donación sospechoso')
    );
  });

  it('link-change cards approve/discard the staged links', async () => {
    renderPage();
    await screen.findByText('Refugio Con Cambio');
    fireEvent.click(screen.getByText('admin:sheltersQueue.approveLinks'));
    await waitFor(() => expect(mockedApi.approveShelterLinks).toHaveBeenCalledWith('sh-2'));
    fireEvent.click(screen.getByText('admin:sheltersQueue.rejectLinks'));
    await waitFor(() => expect(mockedApi.rejectShelterLinks).toHaveBeenCalledWith('sh-2'));
  });

  it('shows the empty state when the queue is clear', async () => {
    mockedApi.getPendingShelters.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('admin:sheltersQueue.empty')).toBeTruthy();
  });

  it('shows an error state with retry on fetch failure (never an empty state)', async () => {
    mockedApi.getPendingShelters.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('admin:sheltersQueue.error')).toBeTruthy();
    expect(screen.getByText('admin:sheltersQueue.retry')).toBeTruthy();
    expect(screen.queryByText('admin:sheltersQueue.empty')).toBeNull();
  });
});
