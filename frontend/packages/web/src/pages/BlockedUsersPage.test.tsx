import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BlockedUsersPage } from './BlockedUsersPage';
import { drawnPaths, iconPath, EMOJI } from '../test/icons';

let mockQuery: Record<string, unknown>;

vi.mock('@shared/hooks', () => ({
  useBlockedUsers: () => mockQuery,
  useUnblockUser: () => ({ mutate: vi.fn(), isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockQuery = { data: [], isLoading: false, isError: false };
});

describe('BlockedUsersPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<BlockedUsersPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  // Emoji ignore `currentColor` and dark mode; the states draw icons instead.
  it('el estado vacío dibuja check-circle y no warning, sin emoji', () => {
    const { container } = render(<BlockedUsersPage />, { wrapper });

    expect(container.textContent).not.toMatch(EMOJI);
    expect(drawnPaths(container)).toContain(iconPath('check-circle'));
    expect(drawnPaths(container)).not.toContain(iconPath('warning'));
  });

  it('el estado de error dibuja warning y no check-circle, sin emoji', () => {
    mockQuery = { data: undefined, isLoading: false, isError: true };
    const { container } = render(<BlockedUsersPage />, { wrapper });

    expect(container.textContent).not.toMatch(EMOJI);
    expect(drawnPaths(container)).toContain(iconPath('warning'));
    expect(drawnPaths(container)).not.toContain(iconPath('check-circle'));
  });
});
