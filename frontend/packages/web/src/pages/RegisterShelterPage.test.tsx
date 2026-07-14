import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegisterShelterPage } from './RegisterShelterPage';

const mutateMock = vi.fn();
let verificationData: { email_verified: boolean } | undefined = { email_verified: true };
let myShelterData: unknown = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/hooks', () => ({
  useVerificationStatus: () => ({ data: verificationData }),
  useMyShelter: () => ({ data: myShelterData, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useRegisterShelter: () => ({ mutate: mutateMock, isPending: false }),
}));

vi.mock('@shared/utils/apiErrors', () => ({
  getErrorMessage: () => 'api-error-message',
}));

function renderPage({ withMineRoute = false }: { withMineRoute?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {withMineRoute ? (
          <Routes>
            <Route path="/" element={<RegisterShelterPage />} />
            <Route path="/shelters/mine" element={<div>mine-page-stub</div>} />
          </Routes>
        ) : (
          <RegisterShelterPage />
        )}
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree());
  return { ...result, rerenderPage: () => result.rerender(tree()) };
}

describe('RegisterShelterPage', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    verificationData = { email_verified: true };
    myShelterData = undefined;
  });

  it('shows the 3 process steps and the honest notes on the intro screen', () => {
    renderPage();
    expect(screen.getByText('shelters:register.step1Title')).toBeTruthy();
    expect(screen.getByText('shelters:register.step2Title')).toBeTruthy();
    expect(screen.getByText('shelters:register.step3Title')).toBeTruthy();
    expect(screen.getByText('shelters:register.reviewNote')).toBeTruthy();
    expect(screen.getByText('shelters:register.noMoneyNote')).toBeTruthy();
  });

  it('blocks unverified users with a link to verification instead of the start button', () => {
    verificationData = { email_verified: false };
    renderPage();
    expect(screen.getByText('shelters:register.emailUnverified')).toBeTruthy();
    const verifyLink = screen.getByText('shelters:register.verifyEmailLink');
    expect(verifyLink.closest('a')?.getAttribute('href')).toBe('/profile');
    expect(screen.queryByText('shelters:register.start')).toBeNull();
  });

  it('validates required fields and https URLs before submitting', () => {
    renderPage();
    fireEvent.click(screen.getByText('shelters:register.start'));
    fireEvent.change(screen.getByLabelText('shelters:register.donationUrl'), {
      target: { value: 'http://sin-tls.org' },
    });
    fireEvent.click(screen.getByText('shelters:register.submit'));

    expect(screen.getByText('shelters:register.nameRequired')).toBeTruthy();
    expect(screen.getByText('shelters:register.cityRequired')).toBeTruthy();
    expect(screen.getByText('shelters:register.invalidUrl')).toBeTruthy();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('submits trimmed data and shows the confirmation on success', () => {
    mutateMock.mockImplementation((_data, opts) => opts?.onSuccess?.());
    renderPage();
    fireEvent.click(screen.getByText('shelters:register.start'));
    fireEvent.change(screen.getByLabelText('shelters:register.name'), { target: { value: '  Mi Refugio  ' } });
    fireEvent.change(screen.getByLabelText('shelters:register.city'), { target: { value: 'Montevideo' } });
    fireEvent.change(screen.getByLabelText('shelters:register.donationUrl'), {
      target: { value: 'https://mi.org/donar' },
    });
    fireEvent.click(screen.getByText('shelters:register.submit'));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Mi Refugio', city: 'Montevideo', donation_url: 'https://mi.org/donar' }),
      expect.anything()
    );
    expect(screen.getByText('shelters:register.successTitle')).toBeTruthy();
  });

  it('shows the API error and stays on the form on failure', () => {
    mutateMock.mockImplementation((_data, opts) => opts?.onError?.(new Error('boom')));
    renderPage();
    fireEvent.click(screen.getByText('shelters:register.start'));
    fireEvent.change(screen.getByLabelText('shelters:register.name'), { target: { value: 'Mi Refugio' } });
    fireEvent.change(screen.getByLabelText('shelters:register.city'), { target: { value: 'Montevideo' } });
    fireEvent.click(screen.getByText('shelters:register.submit'));

    expect(screen.getByText('api-error-message')).toBeTruthy();
    expect(screen.queryByText('shelters:register.successTitle')).toBeNull();
  });

  it('redirects to /shelters/mine when the user already has a shelter', () => {
    myShelterData = { id: 's1', status: 'pending' };
    renderPage({ withMineRoute: true });
    expect(screen.getByText('mine-page-stub')).toBeTruthy();
    expect(screen.queryByText('shelters:register.step1Title')).toBeNull();
  });

  it('keeps the confirmation visible when the invalidation repopulates useMyShelter', () => {
    mutateMock.mockImplementation((_data, opts) => opts?.onSuccess?.());
    const { rerenderPage } = renderPage();
    fireEvent.click(screen.getByText('shelters:register.start'));
    fireEvent.change(screen.getByLabelText('shelters:register.name'), { target: { value: 'Mi Refugio' } });
    fireEvent.change(screen.getByLabelText('shelters:register.city'), { target: { value: 'Montevideo' } });
    fireEvent.click(screen.getByText('shelters:register.submit'));
    expect(screen.getByText('shelters:register.successTitle')).toBeTruthy();

    // La invalidación del submit repuebla useMyShelter — el guard de 'done'
    // debe impedir que el redirect se coma la pantalla de confirmación.
    myShelterData = { id: 's1', status: 'pending' };
    rerenderPage();
    expect(screen.getByText('shelters:register.successTitle')).toBeTruthy();
  });
});
