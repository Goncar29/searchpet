import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGoogleSignIn } from './useGoogleSignIn';

const routerState = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: new URLSearchParams(),
  loginWithGoogle: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => routerState.navigate,
  useSearchParams: () => [routerState.search],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ loginWithGoogle: routerState.loginWithGoogle }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  routerState.search = new URLSearchParams();
});

// S12: el alta con Google termina navegando a `returnUrl`, que sale de la URL.
describe('useGoogleSignIn — returnUrl', () => {
  it('al terminar vuelve al path del mismo origen que trae returnUrl', () => {
    routerState.search = new URLSearchParams({ returnUrl: '/pets/123' });
    const { result } = renderHook(() => useGoogleSignIn());
    act(() => result.current.finishOnboarding());
    expect(routerState.navigate).toHaveBeenCalledWith('/pets/123', { replace: true });
  });

  it('al terminar ignora un returnUrl a otro origen y va a /', () => {
    routerState.search = new URLSearchParams({ returnUrl: '/\\evil.example' });
    const { result } = renderHook(() => useGoogleSignIn());
    act(() => result.current.finishOnboarding());
    expect(routerState.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  // El usuario que vuelve no pasa por el paso de ubicacion: navega directo
  // desde handleCredential.
  it('un usuario que vuelve navega a returnUrl apenas entra', async () => {
    routerState.loginWithGoogle.mockResolvedValue(false);
    routerState.search = new URLSearchParams({ returnUrl: '/messages' });
    const { result } = renderHook(() => useGoogleSignIn());
    await act(() => result.current.handleCredential('id-token'));
    expect(routerState.navigate).toHaveBeenCalledWith('/messages', { replace: true });
  });

  it('un usuario que vuelve ignora un returnUrl a otro origen y va a /', async () => {
    routerState.loginWithGoogle.mockResolvedValue(false);
    routerState.search = new URLSearchParams({ returnUrl: '//evil.example' });
    const { result } = renderHook(() => useGoogleSignIn());
    await act(() => result.current.handleCredential('id-token'));
    expect(routerState.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('un usuario nuevo no navega: primero va al paso de ubicacion', async () => {
    routerState.loginWithGoogle.mockResolvedValue(true);
    routerState.search = new URLSearchParams({ returnUrl: '/messages' });
    const { result } = renderHook(() => useGoogleSignIn());
    await act(() => result.current.handleCredential('id-token'));
    expect(routerState.navigate).not.toHaveBeenCalled();
    expect(result.current.showLocationStep).toBe(true);
  });
});
