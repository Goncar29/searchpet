import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MainLayout } from './MainLayout';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const mockUser = vi.hoisted(
  () => ({ current: { id: 'user-1', name: 'Me' } as Record<string, unknown> }),
);

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isAdmin: false,
    user: mockUser.current,
    logout: vi.fn(),
  }),
}));

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

vi.mock('../components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));

vi.mock('@shared/hooks', () => ({
  useUnreadCount: vi.fn(),
  useWebSocket: () => ({ connectionState: 'connected', sendEnvelope: vi.fn() }),
  useMyShelter: () => ({ data: undefined }),
}));

import { useUnreadCount } from '@shared/hooks';

function renderLayout() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MainLayout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MainLayout — badge de mensajes sin leer', () => {
  it('muestra el contador junto a Mensajes cuando hay mensajes sin leer', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 3 } } as unknown as ReturnType<
      typeof useUnreadCount
    >);

    renderLayout();

    // Desktop nav + mobile panel pueden duplicar el link; el badge aparece al menos una vez.
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('trunca el contador a 9+ cuando supera 9', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 23 } } as unknown as ReturnType<
      typeof useUnreadCount
    >);

    renderLayout();

    expect(screen.getAllByText('9+').length).toBeGreaterThan(0);
  });

  it('no muestra badge cuando no hay mensajes sin leer', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 0 } } as unknown as ReturnType<
      typeof useUnreadCount
    >);

    renderLayout();

    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('MainLayout — menú de perfil', () => {
  it('mantiene los privados fuera del nav hasta abrir el menú de perfil', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 0 } } as unknown as ReturnType<
      typeof useUnreadCount
    >);

    renderLayout();

    // Cerrado por defecto: los privados no están en el DOM.
    expect(screen.queryByText('myPets')).toBeNull();
    expect(screen.queryByText('alerts')).toBeNull();
    expect(screen.queryByText('logout')).toBeNull();

    // Abrir el menú de perfil.
    fireEvent.click(screen.getByLabelText('userMenu'));

    expect(screen.getByText('profile')).toBeTruthy();
    expect(screen.getByText('myPets')).toBeTruthy();
    expect(screen.getByText('alerts')).toBeTruthy();
    expect(screen.getByText('logout')).toBeTruthy();
    // isAdmin=false y sin refugio → esas opciones no aparecen.
    expect(screen.queryByText('admin')).toBeNull();
    expect(screen.queryByText('myShelter')).toBeNull();
  });
});

describe('MainLayout — los links del nav salen de i18n', () => {
  it('ningún link del nav trae texto hardcodeado ni emojis', () => {
    // El de Ranking decía `'🏆 Ranking'` a mano: el único de los cinco sin
    // traducir, así que en inglés y portugués quedaba una palabra en español en
    // el medio de la barra. Y el emoji tampoco era decoración — medido en el
    // árbol de accesibilidad de Chrome, el nombre del link era literalmente
    // "🏆 Ranking", o sea que se anunciaba "trofeo Ranking".
    //
    // Con `t: (key) => key`, un link traducido rinde su CLAVE. Cualquier cosa
    // con espacios, tildes o emojis es texto escrito a mano.
    renderLayout();

    const nav = document.querySelector('nav')!;
    const labels = [...nav.querySelectorAll('a')]
      .map((a) => (a.textContent || '').trim())
      .filter(Boolean);

    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(labels).toContain('leaderboard');
  });
});

describe('MainLayout — miniatura del avatar', () => {
  const FOTO =
    'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1785290767/searchpet/pets/abc/foto.webp';

  beforeEach(() => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 0 } } as unknown as ReturnType<
      typeof useUnreadCount
    >);
    mockUser.current = { id: 'user-1', name: 'Me' };
  });

  it('el avatar del navbar pide 64, no la foto original', () => {
    // Es el avatar de MAS frecuencia del sitio: se dibuja en todas las paginas.
    // Y si se queda con la original, el perfil baja DOS variantes de la misma
    // foto (la de 224 de su avatar mas esta), cuando antes compartian URL y
    // eran una sola descarga.
    mockUser.current = { id: 'user-1', name: 'Me', profile_photo_url: FOTO };

    renderLayout();

    const img = screen.getByAltText('Me') as HTMLImageElement;
    expect(img.src).toContain('w_64,h_64,c_lfill,g_auto');
  });

  it('sin foto cae en la inicial, sin romper', () => {
    renderLayout();
    expect(screen.queryByAltText('Me')).toBeNull();
  });
});
