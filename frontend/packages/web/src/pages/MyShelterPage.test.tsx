import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyShelterPage } from './MyShelterPage';

const mutateMock = vi.fn();
const refetchMock = vi.fn();

type HookState = {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  error: { code?: string } | null;
};
let myShelterState: HookState = { data: undefined, isLoading: false, isError: false, error: null };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/hooks', () => ({
  useMyShelter: () => ({ ...myShelterState, refetch: refetchMock }),
  useUpdateMyShelter: () => ({ mutate: mutateMock, isPending: false }),
}));

vi.mock('@shared/utils/apiErrors', () => ({
  getErrorMessage: () => 'api-error-message',
}));

const baseShelter = {
  id: 's1',
  name: 'Mi Refugio',
  city: 'Montevideo',
  phone: '099123456',
  email: 'refugio@test.org',
  description: 'Refugio de prueba',
  website_url: 'https://refugio.org',
  donation_url: 'https://refugio.org/donar',
  is_verified: false,
  created_at: '2026-07-12T00:00:00Z',
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyShelterPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MyShelterPage', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    refetchMock.mockReset();
    myShelterState = { data: undefined, isLoading: false, isError: false, error: null };
  });

  it('pending: highlights the review step', () => {
    myShelterState.data = { ...baseShelter, status: 'pending' };
    renderPage();
    expect(screen.getByText('shelters:register.step2Title')).toBeTruthy();
    expect(screen.queryByText('shelters:mine.rejectedTitle')).toBeNull();
  });

  it('rejected: shows the admin reason and the resubmit button', () => {
    myShelterState.data = { ...baseShelter, status: 'rejected', rejection_reason: 'link roto' };
    renderPage();
    expect(screen.getByText('shelters:mine.rejectedTitle')).toBeTruthy();
    expect(screen.getByText('shelters:mine.rejectedReason')).toBeTruthy();
    expect(screen.getByText('shelters:mine.resubmit')).toBeTruthy();
  });

  it('approved: shows the link-review warning and the pending-link badge', () => {
    myShelterState.data = {
      ...baseShelter,
      status: 'approved',
      pending_donation_url: 'https://nuevo.org/donar',
    };
    renderPage();
    expect(screen.getByText('shelters:mine.approvedTitle')).toBeTruthy();
    expect(screen.getByText('shelters:mine.linkReviewWarning')).toBeTruthy();
    expect(screen.getByText('shelters:mine.linkPendingBadge')).toBeTruthy();
  });

  it('approved: badge also shows for a staged CLEAR (empty string, not undefined)', () => {
    myShelterState.data = { ...baseShelter, status: 'approved', pending_website_url: '' };
    renderPage();
    expect(screen.getByText('shelters:mine.linkPendingBadge')).toBeTruthy();
  });

  it('saving sends every field including explicit empty strings (rule #22)', () => {
    myShelterState.data = { ...baseShelter, status: 'approved' };
    renderPage();
    fireEvent.change(screen.getByLabelText('shelters:register.phone'), { target: { value: '' } });
    fireEvent.click(screen.getByText('shelters:mine.save'));
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '', name: 'Mi Refugio' }),
      expect.anything()
    );
  });

  it('no shelter yet (shelter_not_found): shows the register link, not an error', () => {
    myShelterState = { data: undefined, isLoading: false, isError: true, error: { code: 'shelter_not_found' } };
    renderPage();
    expect(screen.getByText('shelters:mine.noShelterTitle')).toBeTruthy();
    const link = screen.getByText('shelters:mine.registerNow');
    expect(link.closest('a')?.getAttribute('href')).toBe('/shelters/register');
  });

  it('fetch failure: shows a distinct error state with retry (never an empty state)', () => {
    myShelterState = { data: undefined, isLoading: false, isError: true, error: { code: 'internal_error' } };
    renderPage();
    expect(screen.getByText('shelters:mine.loadError')).toBeTruthy();
    fireEvent.click(screen.getByText('shelters:mine.retry'));
    expect(refetchMock).toHaveBeenCalled();
  });
});
