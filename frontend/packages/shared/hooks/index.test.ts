// ============================================================
// Tests for usePublishLost / usePublishStray / usePublishStrayNative
// Runner: Vitest (vitest.shared.config.ts), environment: node with a
// minimal JSDOM polyfill (see vitest.shared.setup.ts) so
// @testing-library/react's renderHook works.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { apiClient } from '../api/client';
import { usePublishLost, usePublishStray, usePublishStrayNative } from './index';
import type { Pet } from '../types';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

const mockPet: Pet = {
  id: 'pet-1',
  name: 'Sin nombre',
  type: 'perro',
  status: 'stray',
  photos: [],
} as Pet;

describe('usePublishLost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls apiClient.publishPetLost with the pet id and location', async () => {
    vi.spyOn(apiClient, 'publishPetLost').mockResolvedValue({ ...mockPet, status: 'lost' });

    const { result } = renderHook(() => usePublishLost(), { wrapper });

    result.current.mutate({ id: 'pet-1', data: { latitude: -34.9, longitude: -56.1 } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.publishPetLost).toHaveBeenCalledWith('pet-1', { latitude: -34.9, longitude: -56.1 });
    expect(result.current.data?.status).toBe('lost');
  });
});

describe('usePublishStray', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a stray pet with initial_report and uploads all photos', async () => {
    vi.spyOn(apiClient, 'createPet').mockResolvedValue(mockPet);
    vi.spyOn(apiClient, 'uploadPhoto').mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' });

    const file1 = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const file2 = new File(['b'], 'b.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => usePublishStray(), { wrapper });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'perro', status: 'stray', initial_report: { latitude: -34.9, longitude: -56.1 } },
      photos: [file1, file2],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.createPet).toHaveBeenCalledWith({
      name: 'Sin nombre',
      type: 'perro',
      status: 'stray',
      initial_report: { latitude: -34.9, longitude: -56.1 },
    });
    expect(apiClient.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(apiClient.uploadPhoto).toHaveBeenNthCalledWith(1, 'pet-1', file1);
    expect(apiClient.uploadPhoto).toHaveBeenNthCalledWith(2, 'pet-1', file2);
    expect(result.current.data).toEqual({ pet: mockPet, failedPhotoIndexes: [] });
  });

  it('returns the created pet and failed photo indexes without throwing when an upload fails', async () => {
    vi.spyOn(apiClient, 'createPet').mockResolvedValue(mockPet);
    vi.spyOn(apiClient, 'uploadPhoto')
      .mockResolvedValueOnce({ id: 'photo-1', url: 'https://x/photo-1.jpg' })
      .mockRejectedValueOnce(new Error('upload failed'));

    const file1 = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const file2 = new File(['b'], 'b.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => usePublishStray(), { wrapper });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'perro', status: 'stray', initial_report: { latitude: -34.9, longitude: -56.1 } },
      photos: [file1, file2],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ pet: mockPet, failedPhotoIndexes: [1] });
  });

  it('does not call uploadPhoto and rejects if createPet fails', async () => {
    vi.spyOn(apiClient, 'createPet').mockRejectedValue(new Error('initial_report_required'));
    vi.spyOn(apiClient, 'uploadPhoto');

    const { result } = renderHook(() => usePublishStray(), { wrapper });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'perro', status: 'stray' },
      photos: [],
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(apiClient.uploadPhoto).not.toHaveBeenCalled();
  });
});

describe('usePublishStrayNative', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a stray pet and uploads photo URIs via uploadPhotoNative', async () => {
    vi.spyOn(apiClient, 'createPet').mockResolvedValue(mockPet);
    vi.spyOn(apiClient, 'uploadPhotoNative').mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' });

    const { result } = renderHook(() => usePublishStrayNative(), { wrapper });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'gato', status: 'stray', initial_report: { latitude: -34.9, longitude: -56.1 } },
      photoUris: ['file:///a.jpg', 'file:///b.jpg'],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.uploadPhotoNative).toHaveBeenCalledTimes(2);
    expect(apiClient.uploadPhotoNative).toHaveBeenNthCalledWith(1, 'pet-1', 'file:///a.jpg');
    expect(result.current.data).toEqual({ pet: mockPet, failedPhotoIndexes: [] });
  });
});
