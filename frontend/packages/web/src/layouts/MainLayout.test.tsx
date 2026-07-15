import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MainLayout } from './MainLayout';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isAdmin: false,
    user: { id: 'user-1', name: 'Me' },
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
