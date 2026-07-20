// ============================================================
// Tests for useUpdateMyFosterHome / useApproveFosterHome / useSuspendFosterHome
// Runner: Vitest (vitest.shared.config.ts), environment: node with a
// minimal JSDOM polyfill (see vitest.shared.setup.ts) so
// @testing-library/react's renderHook works.
//
// Scope: only the foster-home hooks with real cache-invalidation logic.
// Plain passthrough hooks (useFosterHomes, useFosterHomeByID, useMyFosterHome,
// useRegisterFosterHome, useUploadFosterHomePhoto, useDeleteFosterHomePhoto,
// usePendingFosterHomes, useRejectFosterHome, useReinstateFosterHome,
// useFosterHomeLogs, useFosterHomeHistory) are intentionally out of scope.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { apiClient } from '../api/client';
import { useUpdateMyFosterHome, useApproveFosterHome, useSuspendFosterHome } from './index';
import type { MyFosterHome } from '../types';

// Variant of `wrapper` that exposes the QueryClient instance so tests can spy
// on `invalidateQueries` and assert the exact query keys used.
function createWrapperWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapperWithClient = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper: wrapperWithClient };
}

const mockMyFosterHome: MyFosterHome = {
  id: 'fh-1',
  owner_user_id: 'user-1',
  city: 'Montevideo',
  housing_type: 'house',
  animal_types: ['dog'],
  capacity: 2,
  description: 'Hogar transitorio de prueba',
  photos: [],
  created_at: '2026-01-01T00:00:00Z',
  status: 'approved',
};

describe('useUpdateMyFosterHome', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('invalidates fosterHome/mine and fosterHomes queries on success', async () => {
    vi.spyOn(apiClient, 'updateMyFosterHome').mockResolvedValue(mockMyFosterHome);

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateMyFosterHome(), { wrapper: wrapperWithClient });

    result.current.mutate({ city: 'Canelones' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.updateMyFosterHome).toHaveBeenCalledWith({ city: 'Canelones' });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([['fosterHome', 'mine'], ['fosterHomes']])
    );
    expect(invalidatedKeys).toHaveLength(2);
  });
});

describe('useApproveFosterHome', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('invalidates the fosterHomes query on success', async () => {
    vi.spyOn(apiClient, 'approveFosterHome').mockResolvedValue(mockMyFosterHome);

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useApproveFosterHome(), { wrapper: wrapperWithClient });

    result.current.mutate('fh-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.approveFosterHome).toHaveBeenCalledWith('fh-1');

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toEqual(expect.arrayContaining([['fosterHomes']]));
    expect(invalidatedKeys).toHaveLength(1);
  });
});

describe('useSuspendFosterHome', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('invalidates the fosterHomes query on success', async () => {
    vi.spyOn(apiClient, 'suspendFosterHome').mockResolvedValue({
      ...mockMyFosterHome,
      status: 'suspended',
    });

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSuspendFosterHome(), { wrapper: wrapperWithClient });

    result.current.mutate({ id: 'fh-1', reason: 'incumplimiento' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.suspendFosterHome).toHaveBeenCalledWith('fh-1', 'incumplimiento');

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toEqual(expect.arrayContaining([['fosterHomes']]));
    expect(invalidatedKeys).toHaveLength(1);
  });
});
