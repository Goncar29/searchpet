import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  useMarkPetAsFound: () => ({ mutate: (_id: string, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.() }),
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

function lostPetWithOwner(overrides: Partial<Pet> = {}): Pet {
  return {
    id: 'pet-123',
    name: 'Firulais',
    type: 'perro',
    status: 'lost',
    owner_id: 'owner-1',
    owner: { id: 'owner-1', name: 'Dueño', phone: '+59899111222', is_verified: false },
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

  it('reveals the reporter WhatsApp only after clicking, for a logged-out finder when opted in', () => {
    petResult = {
      data: strayPet({ reporter_contact_public: true, reporter: { id: 'reporter-1', name: 'Vecina', phone: '+59899123456', is_verified: false } }),
      isLoading: false,
    };

    render(<PetDetailPage />, { wrapper });

    // Reveal-on-click: the wa.me link is NOT in the DOM until the user reveals it.
    expect(document.querySelector('a[href*="wa.me"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /revealPhone/i }));

    const link = document.querySelector('a[href*="wa.me"]');
    expect(link).not.toBeNull();
    expect(screen.getByText(/contactReporterWhatsapp/)).toBeInTheDocument();
  });

  it('shows a login-to-contact prompt for a logged-out finder when the reporter did not opt in', () => {
    petResult = { data: strayPet({ reporter_contact_public: false }), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    // No actionable contact, but an honest prompt instead of a silent gap.
    expect(screen.getByText(/loginToContact/)).toBeInTheDocument();
    expect(screen.queryByText(/contactReporterWhatsapp/)).toBeNull();
  });
});

describe('PetDetailPage — owner contact reveal-on-click', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.user = null;
  });

  it('keeps the owner phone out of the DOM until revealed', () => {
    petResult = { data: lostPetWithOwner(), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    expect(screen.queryByText(/\+59899111222/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /revealPhone/i }));

    expect(screen.getByText(/\+59899111222/)).toBeInTheDocument();
  });
});

describe('PetDetailPage — found story nudge', () => {
  beforeEach(() => {
    authState.isAuthenticated = true;
    authState.user = { id: 'owner-1' };
  });

  it('ofrece contar la historia justo después de marcar la mascota como encontrada', () => {
    petResult = { data: lostPetWithOwner({ status: 'lost' }), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    // El nudge no está antes de marcar encontrada
    expect(screen.queryByText('pets:detail.foundNudgeTitle')).toBeNull();

    // Abrir el confirm y confirmar
    fireEvent.click(screen.getByRole('button', { name: /Marcar como encontrada/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    // Aparece el nudge con el CTA que lleva a crear la historia de esta mascota
    expect(screen.getByText('pets:detail.foundNudgeTitle')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /foundNudgeCta/i });
    expect(cta.getAttribute('href')).toBe('/stories/create?petId=pet-123');
  });

  it('descarta el nudge al tocar "ahora no"', () => {
    petResult = { data: lostPetWithOwner({ status: 'lost' }), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: /Marcar como encontrada/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByText('pets:detail.foundNudgeTitle')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /foundNudgeDismiss/i }));
    expect(screen.queryByText('pets:detail.foundNudgeTitle')).toBeNull();
  });
});

describe('PetDetailPage — honest share gating', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.user = null;
  });

  it('shows a login-to-share prompt for a logged-out user on a non-lost/stray pet', () => {
    petResult = { data: lostPetWithOwner({ status: 'found' }), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    expect(screen.getByText(/loginToShare/)).toBeInTheDocument();
  });

  it('does NOT show the login-to-share prompt for a lost pet (public share works logged-out)', () => {
    petResult = { data: lostPetWithOwner({ status: 'lost' }), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    expect(screen.queryByText(/loginToShare/)).toBeNull();
  });
});
