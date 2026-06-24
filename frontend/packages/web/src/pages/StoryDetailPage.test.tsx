import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { StoryDetailPage } from './StoryDetailPage';

const likeMutate = vi.fn();
const unlikeMutate = vi.fn();
const mockNavigate = vi.fn();
let mockIsAuthenticated = true;
let mockStory: Record<string, unknown> | null;

vi.mock('@shared/hooks', () => ({
  useStory: () => ({ data: mockStory, isLoading: false, isError: false }),
  useLikeStory: () => ({ mutate: likeMutate, isPending: false }),
  useUnlikeStory: () => ({ mutate: unlikeMutate, isPending: false }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useParams: () => ({ id: 's1' }), useNavigate: () => mockNavigate };
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
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('StoryDetailPage', () => {
  beforeEach(() => {
    likeMutate.mockClear();
    unlikeMutate.mockClear();
    mockNavigate.mockClear();
    mockIsAuthenticated = true;
    mockStory = makeStory();
  });

  it('redirige a login con useNavigate (no full reload) cuando el usuario no está autenticado', () => {
    mockIsAuthenticated = false;
    render(<StoryDetailPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: /gusta/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/login');
    expect(likeMutate).not.toHaveBeenCalled();
    expect(unlikeMutate).not.toHaveBeenCalled();
  });

  it('dispara like cuando está autenticado y la historia no tiene like del viewer', () => {
    mockStory = makeStory({ liked_by_me: false });
    render(<StoryDetailPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: /gusta/i }));

    expect(likeMutate).toHaveBeenCalledWith('s1');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('dispara unlike cuando está autenticado y la historia ya tiene like del viewer', () => {
    mockStory = makeStory({ liked_by_me: true });
    render(<StoryDetailPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: /gusta/i }));

    expect(unlikeMutate).toHaveBeenCalledWith('s1');
    expect(likeMutate).not.toHaveBeenCalled();
  });

  it('muestra la foto de la mascota como hero cuando pet_photo está presente', () => {
    mockStory = makeStory({ pet_photo: 'https://cdn/toby.jpg' });
    render(<StoryDetailPage />, { wrapper });

    const img = screen.getByRole('img', { name: 'Toby' });
    expect(img.getAttribute('src')).toBe('https://cdn/toby.jpg');
  });

  it('no muestra hero cuando pet_photo está ausente', () => {
    mockStory = makeStory();
    render(<StoryDetailPage />, { wrapper });

    expect(screen.queryByRole('img')).toBeNull();
  });
});
