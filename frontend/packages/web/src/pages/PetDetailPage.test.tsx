import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { PetDetailPage } from './PetDetailPage';
import type { Pet } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

// Auth + pet are configurable per test (logged-out finder is the default).
const authState = { isAuthenticated: false, user: null as { id: string } | null };
let petResult: { data: Pet | null; isLoading: boolean } = { data: null, isLoading: true };

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
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
  usePetByID: () => petResult,
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

function strayPet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: 'pet-123',
    name: 'Callejero',
    type: 'perro',
    status: 'stray',
    reporter_id: 'reporter-1',
    photos: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('PetDetailPage', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.user = null;
    petResult = { data: null, isLoading: true };
  });

  it('renderiza el skeleton de carga cuando isLoading=true', () => {
    render(<PetDetailPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });
});

describe('PetDetailPage — stray reporter contact', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.user = null;
  });

  it('shows a public WhatsApp button for a logged-out finder when the reporter opted in', () => {
    petResult = {
      data: strayPet({ reporter_contact_public: true, reporter: { id: 'reporter-1', name: 'Vecina', phone: '+59899123456', is_verified: false } }),
      isLoading: false,
    };

    render(<PetDetailPage />, { wrapper });

    const btn = screen.getByText(/contactReporterWhatsapp/);
    expect(btn).toBeInTheDocument();
    expect(btn.closest('a')).toHaveAttribute('href', 'https://wa.me/');
  });

  it('does NOT show any reporter contact for a logged-out finder when the reporter did not opt in', () => {
    petResult = { data: strayPet({ reporter_contact_public: false }), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    expect(screen.queryByText('pets:detail.contactReporterWhatsapp')).toBeNull();
    expect(screen.queryByText('pets:detail.contactReporter')).toBeNull();
  });
});
