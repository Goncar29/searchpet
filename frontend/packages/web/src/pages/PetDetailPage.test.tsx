import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { PetDetailPage } from './PetDetailPage';
import type { Pet, Photo } from '@shared/types';

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

const reportsState = vi.hoisted(() => ({
  data: [] as unknown[] | undefined,
  isError: false,
}));

vi.mock('@shared/hooks', () => ({
  usePetByID: () => petResult,
  useReportsByPetID: () => ({
    data: reportsState.data,
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: reportsState.isError,
    error: reportsState.isError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
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

describe('PetDetailPage — historial', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.user = null;
    petResult = { data: lostPetWithOwner(), isLoading: false };
    reportsState.data = [];
    reportsState.isError = false;
  });

  // El historial es el unico caso del porte donde la seccion DESAPARECIA
  // entera al fallar: no habia estado vacio que mintiera, habia silencio. El
  // usuario nunca se enteraba de que esta mascota tenia un historial.
  it('con el historial caido avisa en vez de desaparecer', () => {
    reportsState.data = undefined;
    reportsState.isError = true;

    render(<PetDetailPage />, { wrapper });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // La otra mitad de la distincion. Una mascota que de verdad no tiene
  // reportes NO gana una tarjeta vacia: el silencio ahi es correcto, y es lo
  // que separa "no hay nada que mostrar" de "no pudimos leerlo".
  it('sin reportes la seccion sigue sin aparecer, y sin cartel', () => {
    render(<PetDetailPage />, { wrapper });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/pets:detail.timeline/)).not.toBeInTheDocument();
  });
});

describe('PetDetailPage', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.user = null;
    petResult = { data: null, isLoading: true };
    reportsState.data = [];
    reportsState.isError = false;
  });

  it('renderiza el skeleton de carga cuando isLoading=true', () => {
    render(<PetDetailPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  // `t` is mocked to echo its key, so there is no English in this harness: a
  // translated string renders as `pets:detail.x` and a hardcoded one renders as
  // Spanish. That difference is the assertion. It proves the string stopped
  // being a literal — it cannot prove the English reads well, which is why
  // e2e/pet-detail.spec.ts drives a browser that resolves the app to English.
  it('pasa el flujo de marcar como encontrada por i18n y no por español hardcodeado', () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'owner-1' };
    petResult = { data: lostPetWithOwner(), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    // `$` anchors the match so markFoundSaving and markFoundConfirm don't satisfy it.
    const markFound = screen.getByRole('button', { name: /pets:detail\.markFound$/ });
    expect(screen.queryByText(/Marcar como encontrada/)).not.toBeInTheDocument();

    fireEvent.click(markFound);

    // The confirmation of an irreversible action must go through i18n.
    expect(screen.queryByText(/Confirmás/)).not.toBeInTheDocument();
    expect(screen.getByText(/pets:detail\.markFoundConfirm/)).toBeInTheDocument();
  });

  // La OTRA mitad del mismo invariante. El test de abajo cubre el CSS
  // (object-contain); este cubre lo que se le pide a Cloudinary. Con `c_lfill`
  // la foto llegaria YA recortada y el object-contain la mostraria entera sin
  // que nada se vea roto — o sea que el guard del CSS solo no alcanza.
  it('le pide a Cloudinary que NO recorte, y el fondo comparte la url', () => {
    const FOTO = 'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1785290767/searchpet/pets/abc/foto.webp';
    petResult = {
      data: lostPetWithOwner({
        photos: [{ id: 'p1', url: FOTO, is_primary: true } as Photo],
      }),
      isLoading: false,
    };

    const { container } = render(<PetDetailPage />, { wrapper });

    const img = container.querySelector('img[alt]') as HTMLImageElement;
    expect(img.src).toContain('c_limit');
    expect(img.src).not.toContain('c_lfill');

    // El fondo borroso tiene que pedir EXACTAMENTE la misma url. Si pidiera su
    // propio tamaño serian dos descargas donde hoy hay una — la trampa que se
    // colo con el avatar del navbar en el #167.
    const backdrop = container.querySelector('[data-hero-backdrop]') as HTMLElement;
    expect(backdrop.style.backgroundImage).toContain(img.src);
  });

  it('nunca recorta la foto de la mascota', () => {
    petResult = {
      data: lostPetWithOwner({
        photos: [{ id: 'p1', url: 'https://example.com/a.jpg', is_primary: true } as Photo],
      }),
      isLoading: false,
    };

    render(<PetDetailPage />, { wrapper });

    // object-contain is the whole point of the hero: the design paints the photo
    // edge to edge, and a cropped vertical photo loses the animal's head on the
    // one page whose job is to let someone recognise it.
    expect(screen.getByAltText('Firulais')).toHaveClass('object-contain');

    // The blurred fill that gives the design its full frame is decoration and
    // must stay out of the accessibility tree — the real <img> carries the alt.
    expect(document.querySelector('[data-hero-backdrop]')).toHaveAttribute('aria-hidden', 'true');

    // The name lives in the hero now. Rendering it here and in the old <h1> too
    // would read it twice to a screen reader.
    expect(screen.getAllByText('Firulais')).toHaveLength(1);
  });

  it('omite las fact cards de los campos opcionales vaciados', () => {
    // Breed and color are optional and can be explicitly emptied (an update
    // sends "" to clear them), so the page must not render a card that is just
    // a heading with nothing under it.
    petResult = { data: lostPetWithOwner({ breed: '', color: '' }), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    expect(screen.getByText('pets:detail.type')).toBeInTheDocument();
    expect(screen.queryByText('pets:detail.breed')).not.toBeInTheDocument();
    expect(screen.queryByText('pets:detail.color')).not.toBeInTheDocument();
  });

  it('no deja hijos de grid vacíos cuando no hay sidebar ni reportes', () => {
    // A stray whose own reporter is looking at it: the owner block does not
    // apply, the reporter block returns null for the reporter themselves, and
    // the abuse block is hidden because they manage the pet. All three empty.
    authState.isAuthenticated = true;
    authState.user = { id: 'reporter-1' };
    petResult = { data: strayPet(), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    // An empty <aside> would still claim the grid's 1fr column and leave a
    // third of the page blank next to a squeezed left column.
    expect(document.querySelector('aside')).toBeNull();

    // With no sidebar the grid must collapse to one column, or the timeline —
    // the next grid child — lands in the right-hand column instead of below.
    const body = document.querySelector('[data-detail-body]');
    expect(body?.className).not.toMatch(/lg:grid-cols-/);

    // No reports and no sidebar: the left column is the only child left.
    expect(body?.children).toHaveLength(1);
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
    fireEvent.click(screen.getByRole('button', { name: /pets:detail.markFound$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'common:confirm' }));

    // Aparece el nudge con el CTA que lleva a crear la historia de esta mascota
    expect(screen.getByText('pets:detail.foundNudgeTitle')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /foundNudgeCta/i });
    expect(cta.getAttribute('href')).toBe('/stories/create?petId=pet-123');
  });

  it('descarta el nudge al tocar "ahora no"', () => {
    petResult = { data: lostPetWithOwner({ status: 'lost' }), isLoading: false };

    render(<PetDetailPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: /pets:detail.markFound$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'common:confirm' }));
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

// El destino del link que arma la tabla "Reportes creados" del panel de impacto.
// Vive acá y no allá porque son las DOS MITADES de la misma cosa: aquel test
// afirma que el href apunta a `#reporte-<id>`, y éste que ese id existe. Sin
// los dos, renombrar el ancla de un lado deja el otro verde y el link muerto.
describe('PetDetailPage — ancla del historial', () => {
  function wrapperConHash(hash: string) {
    return function W({ children }: { children: React.ReactNode }) {
      return (
        <HelmetProvider>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <MemoryRouter initialEntries={[`/pets/pet-123${hash}`]}>{children}</MemoryRouter>
          </QueryClientProvider>
        </HelmetProvider>
      );
    };
  }

  const dosReportes = [
    { id: 'r1', pet_id: 'pet-123', status: 'lost', created_at: '2026-07-01T00:00:00Z' },
    { id: 'r2', pet_id: 'pet-123', status: 'sighting', created_at: '2026-07-02T00:00:00Z' },
  ];

  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.user = null;
    petResult = { data: lostPetWithOwner({ status: 'lost' }), isLoading: false };
    reportsState.data = dosReportes;
    reportsState.isError = false;
  });

  it('cada entrada del historial lleva el id que el ancla busca', () => {
    render(<PetDetailPage />, { wrapper: wrapperConHash('') });

    expect(document.getElementById('reporte-r1')).not.toBeNull();
    expect(document.getElementById('reporte-r2')).not.toBeNull();
  });

  // El efecto es lo que hace que el link funcione DE VERDAD: el navegador
  // resuelve el hash al cargar el documento, pero los reportes llegan después
  // por una query, así que en ese momento el elemento todavía no está en el
  // DOM y el salto nunca ocurre. Sin esto el link navega y no pasa nada.
  it('con el hash puesto, salta al reporte una vez que los datos llegaron', () => {
    const saltos: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
      saltos.push((this as HTMLElement).id);
    };

    try {
      render(<PetDetailPage />, { wrapper: wrapperConHash('#reporte-r2') });
      expect(saltos).toEqual(['reporte-r2']);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  // El resaltado NO puede depender de la variante `target:` de CSS. Medido en
  // el navegador: por URL directa `:target` pinta, pero llegando por CLICK desde
  // el panel de impacto NO — React Router navega con `pushState` y en ese
  // instante el elemento del fragmento todavia no existe. El camino por click es
  // el que la gente usa, asi que el resaltado va por estado.
  //
  // Este test se pone rojo si alguien vuelve a las clases `target:`: jsdom no
  // aplica `:target` nunca, asi que la clase condicional es lo unico
  // observable.
  it('marca el reporte de destino con una clase propia, no con :target', () => {
    render(<PetDetailPage />, { wrapper: wrapperConHash('#reporte-r2') });

    const destino = document.getElementById('reporte-r2');
    const otro = document.getElementById('reporte-r1');
    expect(destino?.className).toMatch(/ring-2/);
    expect(destino?.className).not.toMatch(/target:/);
    expect(otro?.className).not.toMatch(/ring-2/);
  });

  it('sin hash no salta a ningún lado', () => {
    const saltos: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
      saltos.push((this as HTMLElement).id);
    };

    try {
      render(<PetDetailPage />, { wrapper: wrapperConHash('') });
      expect(saltos).toEqual([]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
