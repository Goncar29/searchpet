import { QueryClient } from '@tanstack/react-query';

/**
 * Builds the app-wide React Query client.
 *
 * `staleTime` is intentionally short (30s). A 5-minute staleTime meant that data
 * changed by another user or in another session (e.g. a new abuse report) stayed
 * frozen in the cache until a manual page refresh — React Query won't refetch a
 * query it still considers fresh, even on mount or window focus (backlog #12).
 * 30s keeps rapid re-renders/navigation deduped while making the UI converge to
 * fresh data whenever the user returns to a tab or navigates to a page.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        staleTime: 30 * 1000,
        refetchOnWindowFocus: true,
      },
    },
  });
}
