import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { StoriesPage } from './StoriesPage';

const likeMutate = vi.fn();
const unlikeMutate = vi.fn();
const mockNavigate = vi.fn();
let mockStories: unknown[] = [];
let mockIsAuthenticated = true;

vi.mock('@shared/hooks', () => ({
  useStories: () => ({ data: mockStories, isLoading: false }),
  useLikeStory: () => ({ mutate: likeMutate, isPending: false }),
  useUnlikeStory: () => ({ mutate: unlikeMutate, isPending: false }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

function makeStory(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    title: 'Volvió a casa',
    body: 'Una historia hermosa.',
    like_count: 3,
    liked_by_me: false,
    featured: false,
    pet_name: 'Toby',
    user_name: 'Ana',
    created_at: '2026-06-14T00:00:00Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('StoriesPage', () => {
  beforeEach(() => {
    likeMutate.mockClear();
    unlikeMutate.mockClear();
    mockNavigate.mockClear();
    mockStories = [];
    mockIsAuthenticated = true;
  });

  it('renderiza el estado vacío cuando no hay historias', () => {
    render(<StoriesPage />, { wrapper });
    expect(screen.getByText('Todavía no hay historias')).toBeTruthy();
  });

  it('muestra el corazón en outline y dispara like cuando liked_by_me es false', () => {
    mockStories = [makeStory({ liked_by_me: false })];
    render(<StoriesPage />, { wrapper });

    const button = screen.getByRole('button', { name: /me gusta/i });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toContain('🤍');

    fireEvent.click(button);
    expect(likeMutate).toHaveBeenCalledWith('s1');
    expect(unlikeMutate).not.toHaveBeenCalled();
  });

  it('muestra el corazón relleno y dispara unlike cuando liked_by_me es true', () => {
    mockStories = [makeStory({ liked_by_me: true })];
    render(<StoriesPage />, { wrapper });

    const button = screen.getByRole('button', { name: /me gusta/i });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('❤️');

    fireEvent.click(button);
    expect(unlikeMutate).toHaveBeenCalledWith('s1');
    expect(likeMutate).not.toHaveBeenCalled();
  });

  it('redirige a login y no mutea cuando el usuario no está autenticado', () => {
    mockIsAuthenticated = false;
    mockStories = [makeStory({ liked_by_me: false })];
    render(<StoriesPage />, { wrapper });

    const button = screen.getByRole('button', { name: /me gusta/i });
    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledWith('/login');
    expect(likeMutate).not.toHaveBeenCalled();
    expect(unlikeMutate).not.toHaveBeenCalled();
  });
});
