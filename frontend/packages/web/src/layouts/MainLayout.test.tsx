import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MainLayout } from './MainLayout';
import type { WsEnvelope, WsConnectionState, UseWebSocketOptions } from '@shared/hooks';

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

const themeState = vi.hoisted(() => ({ current: 'light' as 'light' | 'dark' }));
// Un solo mock para toda la suite (no uno nuevo por render) para poder afirmar
// que el botón lo llama; se limpia en el afterEach del describe del toggle.
const toggleTheme = vi.hoisted(() => vi.fn());

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: themeState.current, toggleTheme }),
}));

vi.mock('../components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));

vi.mock('@shared/hooks', () => ({
  useUnreadCount: vi.fn(),
  useWebSocket: vi.fn(() => ({ connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() })),
  useMyShelter: () => ({ data: undefined }),
  UNREAD_COUNT_KEY: ['messages', 'unread-count'],
}));

import { useUnreadCount, useWebSocket, UNREAD_COUNT_KEY } from '@shared/hooks';
import { Icon } from '../components/Icon';

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

describe('MainLayout — WebSocket compartido: invalidaciones', () => {
  beforeEach(() => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 0 } } as unknown as ReturnType<
      typeof useUnreadCount
    >);
  });

  it('un chat_message invalida el PREFIJO ["messages"] — es el invariante del que dependen ChatPage y MessagesPage', () => {
    // ChatPage y MessagesPage dejaron de invalidar por su cuenta ante
    // chat_message, confiando en que ESTE onMessage invalida SIN `exact`, asi
    // que matchea la lista (`['messages']`) Y cualquier hilo
    // (`['messages', <id>]` empieza con ese prefijo). Si esto se volviera
    // `exact: true`, los hilos abiertos dejarian de refrescarse y nadie mas
    // lo haria por ellos — por eso el guard de mutacion de este test es tan
    // importante como el propio test.
    let capturedOnMessage: ((env: WsEnvelope) => void) | null = null;
    vi.mocked(useWebSocket).mockImplementationOnce(({ onMessage }: UseWebSocketOptions) => {
      capturedOnMessage = onMessage;
      return { connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() };
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MainLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    act(() => {
      capturedOnMessage?.({
        type: 'chat_message',
        payload: { id: 'm', from: 'user-2', to: 'user-1', body: 'hola', timestamp: '' },
      });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['messages'] });
    // Y sin `exact`: un `exact: true` dejaria afuera cualquier hilo.
    expect(spy.mock.calls[0][0]).not.toHaveProperty('exact');
  });

  it('un badge_update actualiza el contador de no leidos, y NO toca la lista de mensajes', () => {
    let capturedOnMessage: ((env: WsEnvelope) => void) | null = null;
    vi.mocked(useWebSocket).mockImplementationOnce(({ onMessage }: UseWebSocketOptions) => {
      capturedOnMessage = onMessage;
      return { connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() };
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const setSpy = vi.spyOn(client, 'setQueryData');

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MainLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    act(() => {
      capturedOnMessage?.({ type: 'badge_update', payload: { user_id: 'user-1', unread_count: 5 } });
    });

    expect(setSpy).toHaveBeenCalledWith(UNREAD_COUNT_KEY, { count: 5 });
    expect(invalidateSpy).not.toHaveBeenCalled();
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

// El toggle de tema dibujaba un emoji (☀️/🌙): cada sistema lo pinta con su
// propia fuente, en color, y no sigue el `currentColor` del resto del navbar.
// Ahora es un ícono de Material Symbols, como los demás controles.
describe('MainLayout — toggle de tema', () => {
  beforeEach(() => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 0 } } as unknown as ReturnType<
      typeof useUnreadCount
    >);
  });

  // En un afterEach y no al final del test: si una aserción falla antes, el
  // tema oscuro no se filtra a los tests que siguen.
  afterEach(() => {
    themeState.current = 'light';
    toggleTheme.mockClear();
  });

  function pathOf(name: 'light-mode' | 'dark-mode') {
    const { container, unmount } = render(<Icon name={name} />);
    const d = container.querySelector('path')?.getAttribute('d');
    unmount();
    return d;
  }

  it.each([
    // En claro ofrece pasar a oscuro (luna); en oscuro, pasar a claro (sol).
    ['light', 'dark-mode'],
    ['dark', 'light-mode'],
  ] as const)('en tema %s dibuja el ícono %s, sin emoji', (theme, icon) => {
    themeState.current = theme;
    const expected = pathOf(icon);
    renderLayout();

    const button = screen.getByRole('button', { name: 'darkMode' });
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg path')?.getAttribute('d')).toBe(expected);
  });

  // Cambiar el emoji por un ícono no puede dejar el botón sin su acción.
  it('el botón del toggle llama a toggleTheme una sola vez por click', () => {
    renderLayout();
    expect(toggleTheme).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'darkMode' }));

    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });

  // Sin esto, dos íconos idénticos pasarían los dos casos de arriba.
  it('los íconos de claro y oscuro son distintos', () => {
    expect(pathOf('light-mode')).toBeTruthy();
    expect(pathOf('light-mode')).not.toBe(pathOf('dark-mode'));
  });
});
