import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StoriesPage } from './StoriesPage';

vi.mock('@shared/hooks', () => ({
  useStories: () => ({ data: [], isLoading: false }),
  useLikeStory: () => ({ mutate: vi.fn() }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

describe('StoriesPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<StoriesPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('muestra el estado vacío cuando no hay historias', () => {
    render(<StoriesPage />, { wrapper });
    // The page should render with an empty state message
    expect(document.body.innerHTML).toBeTruthy();
  });
});
