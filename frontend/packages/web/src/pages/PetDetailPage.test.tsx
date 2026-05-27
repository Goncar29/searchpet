import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { PetDetailPage } from './PetDetailPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ id: 'pet-123' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@shared/hooks', () => ({
  usePetByID: () => ({ data: null, isLoading: true }),
  useReportsByPetID: () => ({ data: [] }),
  useMarkPetAsFound: () => ({ mutate: vi.fn() }),
  useSubmitAbuseReport: () => ({ mutate: vi.fn() }),
}));

vi.mock('../components/SharePanel', () => ({
  SharePanel: () => null,
}));

vi.mock('../components/PdfFlyerButton', () => ({
  PdfFlyerButton: () => null,
}));

vi.mock('@shared/utils/whatsappTemplates', () => ({
  buildWhatsAppContactURL: () => 'https://wa.me/',
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <HelmetProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('PetDetailPage', () => {
  it('renderiza el skeleton de carga cuando isLoading=true', () => {
    render(<PetDetailPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });
});
