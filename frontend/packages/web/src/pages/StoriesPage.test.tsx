import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { StoriesPage } from './StoriesPage';

const likeMutate = vi.fn();
const unlikeMutate = vi.fn();
const mockNavigate = vi.fn();
let mockStories: unknown[] | undefined = [];
let mockStoriesError = false;
let mockIsAuthenticated = true;
let mockStats: { pets_reunited: number } | undefined = { pets_reunited: 1200 };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/hooks', () => ({
  useStories: () => ({
    data: mockStories,
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: mockStoriesError,
    error: mockStoriesError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
  useLikeStory: () => ({ mutate: likeMutate, isPending: false }),
  useUnlikeStory: () => ({ mutate: unlikeMutate, isPending: false }),
  // Every hook the page calls has to be in this mock: the factory REPLACES the
  // module, so a hook left out is `undefined` and the render dies with
  // "is not a function" — a failure that reads like a bug in the page.
  useStats: () => ({ data: mockStats }),
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
    mockStoriesError = false;
    mockIsAuthenticated = true;
    mockStats = { pets_reunited: 1200 };
  });

  // The counter reads a SECOND query (`/api/stats`), independent from the list.
  // These four cases pin that it never states something the data does not say.
  describe('el contador de vidas reencontradas', () => {
    it('se dibuja cuando el dato llegó', () => {
      render(<StoriesPage />, { wrapper });
      expect(screen.getByText('stories:reunitedLabel')).toBeInTheDocument();
      expect(screen.getByText((1200).toLocaleString())).toBeInTheDocument();
    });

    // The whole reason the counter is conditional. With `?? 0` this renders a
    // giant "0" over the word "reunited" — a page-level claim that nobody has
    // ever been found, built out of a request that simply failed.
    it('NO se dibuja cuando /api/stats no cargó', () => {
      mockStats = undefined;
      render(<StoriesPage />, { wrapper });
      expect(screen.queryByText('stories:reunitedLabel')).not.toBeInTheDocument();
    });

    it('NO se dibuja en cero', () => {
      mockStats = { pets_reunited: 0 };
      render(<StoriesPage />, { wrapper });
      expect(screen.queryByText('stories:reunitedLabel')).not.toBeInTheDocument();
    });

    // A failed LIST must not take the counter down with it: they are separate
    // queries and the counter is still true.
    it('sobrevive a que la lista se caiga', () => {
      mockStories = undefined;
      mockStoriesError = true;
      render(<StoriesPage />, { wrapper });
      expect(screen.getByText('stories:reunitedLabel')).toBeInTheDocument();
    });
  });

  // The invitation to write lives OUTSIDE ListState, so it has to survive every
  // branch — and it matters most in the two where there is nothing to read.
  describe('la invitación a contar una historia', () => {
    it.each([
      ['con historias', () => { mockStories = [makeStory()]; }],
      ['con la lista vacía', () => { mockStories = []; }],
      ['con la lista caída', () => { mockStories = undefined; mockStoriesError = true; }],
    ])('se muestra %s', (_caso, setup) => {
      setup();
      render(<StoriesPage />, { wrapper });
      expect(screen.getByRole('link', { name: /stories:cta.button/ })).toHaveAttribute(
        'href',
        '/stories/create'
      );
    });

    // /stories/create is a protected route that bounces to login, so gating the
    // link on the session would hide the entry point from exactly the visitor
    // it is meant to convert.
    it('se muestra también sin sesión', () => {
      mockIsAuthenticated = false;
      mockStories = [makeStory()];
      render(<StoriesPage />, { wrapper });
      expect(screen.getByRole('link', { name: /stories:cta.button/ })).toBeInTheDocument();
    });
  });

  // The other half of the home's assertion: this page asks for the panel
  // variant. Testing only "the home stays overlay" would still pass if the
  // panel were never wired up anywhere.
  it('dibuja las historias en la variante panel', () => {
    mockStories = [makeStory()];
    render(<StoriesPage />, { wrapper });
    expect(screen.getByText('readMore')).toBeInTheDocument();
  });

  it('renderiza el estado vacío cuando no hay historias', () => {
    render(<StoriesPage />, { wrapper });
    expect(screen.getByText('stories:empty.title')).toBeTruthy();
  });

  it('con la query caida NO dice que no hay historias', () => {
    mockStories = undefined;
    mockStoriesError = true;

    render(<StoriesPage />, { wrapper });

    expect(screen.queryByText('stories:empty.title')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // The like state is asserted through aria-pressed, not through the glyph.
  // aria-pressed is what a screen reader announces and what the icon is derived
  // from, so it is the contract worth pinning; the previous emoji assertions
  // broke the moment the hearts became SVG without any behaviour changing.
  //
  // The role query stays scoped by accessible name so that a future second
  // control on the card fails these tests only if it breaks the like button.
  // StoryCard binds the namespace (`useTranslation('stories')`) and calls
  // `t('like')`, so under the key-returning mock the name is 'like', not
  // 'stories:like'.
  it('marca aria-pressed=false y dispara like cuando liked_by_me es false', () => {
    mockStories = [makeStory({ liked_by_me: false })];
    render(<StoriesPage />, { wrapper });

    const button = screen.getByRole('button', { name: 'like' });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);
    expect(likeMutate).toHaveBeenCalledWith('s1');
    expect(unlikeMutate).not.toHaveBeenCalled();
  });

  it('marca aria-pressed=true y dispara unlike cuando liked_by_me es true', () => {
    mockStories = [makeStory({ liked_by_me: true })];
    render(<StoriesPage />, { wrapper });

    const button = screen.getByRole('button', { name: 'unlike' });
    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button);
    expect(unlikeMutate).toHaveBeenCalledWith('s1');
    expect(likeMutate).not.toHaveBeenCalled();
  });

  it('redirige a login y no mutea cuando el usuario no está autenticado', () => {
    mockIsAuthenticated = false;
    mockStories = [makeStory({ liked_by_me: false })];
    render(<StoriesPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'like' }));

    expect(mockNavigate).toHaveBeenCalledWith('/login');
    expect(likeMutate).not.toHaveBeenCalled();
    expect(unlikeMutate).not.toHaveBeenCalled();
  });

  // This page used to read `pet_photo` and nothing else, so a story whose photo
  // lived in `photo_after` rendered without an image here while the same story
  // rendered with one on the home. These four cases pin the shared order.
  it('usa photo_after cuando está presente', () => {
    mockStories = [makeStory({ photo_after: 'https://cdn/after.jpg', pet_photo: 'https://cdn/pet.jpg' })];
    render(<StoriesPage />, { wrapper });
    expect(screen.getByRole('img', { name: 'Toby' }).getAttribute('src')).toBe('https://cdn/after.jpg');
  });

  it('cae a pet_photo y después a photo_before', () => {
    mockStories = [makeStory({ pet_photo: 'https://cdn/pet.jpg' })];
    const { unmount } = render(<StoriesPage />, { wrapper });
    expect(screen.getByRole('img', { name: 'Toby' }).getAttribute('src')).toBe('https://cdn/pet.jpg');
    unmount();

    mockStories = [makeStory({ photo_before: 'https://cdn/before.jpg' })];
    render(<StoriesPage />, { wrapper });
    expect(screen.getByRole('img', { name: 'Toby' }).getAttribute('src')).toBe('https://cdn/before.jpg');
  });

  it('no muestra imagen cuando no hay ninguna de las tres fotos', () => {
    mockStories = [makeStory()];
    render(<StoriesPage />, { wrapper });
    expect(screen.queryByRole('img')).toBeNull();
  });

  // The API stores '' — not null — for a photo that was never set, and
  // <img src=""> resolves against the page URL and draws as a broken image.
  // Verified by restoring the defect: this goes red only when BOTH guards in
  // StoryCard flip together (`||` → `??` AND `cover` → `cover !== undefined`).
  // Either one alone still renders correctly, so this pins the pair, not `||`.
  it('trata el string vacío como ausencia de foto', () => {
    mockStories = [makeStory({ photo_after: '', pet_photo: '', photo_before: '' })];
    render(<StoriesPage />, { wrapper });
    expect(screen.queryByRole('img')).toBeNull();
  });
});
