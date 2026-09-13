// ============================================================
// Tests for useUpdateMyFosterHome / useApproveFosterHome / useSuspendFosterHome
// Runner: Vitest (vitest.shared.config.ts), environment: node with a
// minimal JSDOM polyfill (see vitest.shared.setup.ts) so
// @testing-library/react's renderHook works.
//
// Scope: the foster-home hooks with real logic — cache invalidation, plus
// useFosterHomeByID's retry predicate, which decides whether a failed read is
// worth retrying at all.
//
// useFosterHomeByID used to be listed below as a plain passthrough. It stopped
// being one the moment it grew a `retry` predicate, and the header kept saying
// otherwise — which is how a hook with real behaviour ends up with no test:
// both screen tests mock it wholesale, so inverting the predicate left every
// suite in the repo green.
//
// Plain passthrough hooks (useFosterHomes, useMyFosterHome,
// useRegisterFosterHome, useUploadFosterHomePhoto, useDeleteFosterHomePhoto,
// usePendingFosterHomes, useRejectFosterHome, useReinstateFosterHome,
// useFosterHomeLogs, useFosterHomeHistory) are intentionally out of scope.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { apiClient, ApiError } from '../api/client';
import {
  useUpdateMyFosterHome,
  useApproveFosterHome,
  useSuspendFosterHome,
  useFosterHomeByID,
} from './index';
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

// ============================================================
// useFosterHomeByID — el predicado de reintento
// ============================================================
//
// POR QUÉ ESTO VIVE ACÁ Y NO EN UN TEST DE PANTALLA: los dos tests de pantalla
// (web y mobile) MOCKEAN el hook entero, así que ninguno puede ver el predicado.
// Invertirlo —`return definitivo && intentos < 2`, o sea reintentar justamente
// contra los 404— dejaba TODA la suite del repo en verde.
//
// Y se cuentan LOS PEDIDOS, no `isError`: el hook falla igual con una forma u
// otra del predicado. Lo que cambia es cuántas veces le pegamos a una respuesta
// que ya sabemos definitiva, y eso sólo se ve contando llamadas.
describe('useFosterHomeByID — no reintenta contra respuestas definitivas', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * El default es `retry: 2` A PROPÓSITO: es el que traen los dos clientes raíz
   * (`mobile/app/_layout.tsx`, `web/src/lib/queryClient.ts`). Con `retry: false`
   * acá, el caso del 502 daría 1 pedido y el test pasaría sin distinguir nada.
   *
   * `retryDelay: 0` para no pagar el backoff real (1s + 2s) en cada caso.
   */
  function wrapperConReintentos() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 2, retryDelay: 0 } },
    });
    return ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
  }

  async function pedidosAnte(error: unknown): Promise<number> {
    const spy = vi.spyOn(apiClient, 'getFosterHomeByID').mockRejectedValue(error);
    const { result } = renderHook(() => useFosterHomeByID('fh-1'), {
      wrapper: wrapperConReintentos(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    return spy.mock.calls.length;
  }

  it('un 404 se pide UNA sola vez', async () => {
    expect(await pedidosAnte(new ApiError('not_found', 404, 'not found'))).toBe(1);
  });

  // Un id malformado sale por `uuid.Parse` → `ErrInvalidInput` → 400. Es tan
  // definitivo como el 404 y la pantalla lo trata igual.
  it('un 400 se pide UNA sola vez', async () => {
    expect(await pedidosAnte(new ApiError('invalid_input', 400, 'invalid uuid'))).toBe(1);
  });

  // LA OTRA MITAD, sin la cual `retry: false` pasaría estos tests igual: contra
  // un 5xx reintentar SÍ sirve, y el predicado tiene que reproducir exactamente
  // los dos reintentos del default heredado.
  it('un 502 conserva los dos reintentos del default', async () => {
    expect(await pedidosAnte(new ApiError('server_error', 502, 'bad gateway'))).toBe(3);
  });

  // Una conexión que se corta ANTES de cualquier respuesta no produce
  // `ApiError`, así que no hay status que mirar y reintentar es lo correcto.
  it('un error sin ApiError también reintenta', async () => {
    expect(await pedidosAnte(new TypeError('Failed to fetch'))).toBe(3);
  });
});
