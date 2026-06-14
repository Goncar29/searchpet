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
import {
  usePublishLost,
  usePublishStray,
  usePublishStrayNative,
  useUploadPhoto,
  useUploadPhotoNative,
} from './index';
import type { Pet } from '../types';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

// Variant of `wrapper` that exposes the QueryClient instance so tests can spy
// on `invalidateQueries` and assert the exact query keys used.
function createWrapperWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapperWithClient = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper: wrapperWithClient };
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

  it('invalidates pets, pets/:id, pets/mine, and reports queries on success', async () => {
    vi.spyOn(apiClient, 'publishPetLost').mockResolvedValue({ ...mockPet, status: 'lost' });

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => usePublishLost(), { wrapper: wrapperWithClient });

    result.current.mutate({ id: 'pet-1', data: { latitude: -34.9, longitude: -56.1 } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([['pets'], ['pets', 'pet-1'], ['pets', 'mine'], ['reports']])
    );
    expect(invalidatedKeys).toHaveLength(4);
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

  it('returns failedPhotoIndexes [0, 2] when the first and third of three uploads fail', async () => {
    vi.spyOn(apiClient, 'createPet').mockResolvedValue(mockPet);
    vi.spyOn(apiClient, 'uploadPhoto')
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce({ id: 'photo-2', url: 'https://x/photo-2.jpg' })
      .mockRejectedValueOnce(new Error('upload failed'));

    const file1 = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const file2 = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
    const file3 = new File(['c'], 'c.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => usePublishStray(), { wrapper });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'perro', status: 'stray', initial_report: { latitude: -34.9, longitude: -56.1 } },
      photos: [file1, file2, file3],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.uploadPhoto).toHaveBeenCalledTimes(3);
    expect(result.current.data).toEqual({ pet: mockPet, failedPhotoIndexes: [0, 2] });
  });

  it('invalidates pets, pets/:id, pets/mine, and reports queries on success', async () => {
    vi.spyOn(apiClient, 'createPet').mockResolvedValue(mockPet);
    vi.spyOn(apiClient, 'uploadPhoto').mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' });

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => usePublishStray(), { wrapper: wrapperWithClient });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'perro', status: 'stray', initial_report: { latitude: -34.9, longitude: -56.1 } },
      photos: [],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([['pets'], ['pets', 'mine'], ['pets', mockPet.id], ['reports']])
    );
    expect(invalidatedKeys).toHaveLength(4);
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

describe('useUploadPhoto', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Regression: uploading a photo from the "My reports" tab must refresh the
  // ['pets','reported'] query so the new photo shows up for stray reporters.
  it('invalidates the pet detail, pets/mine and pets/reported queries on success', async () => {
    vi.spyOn(apiClient, 'uploadPhoto').mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' });

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUploadPhoto(), { wrapper: wrapperWithClient });

    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    result.current.mutate({ petId: 'pet-1', file });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([['pets', 'pet-1'], ['pets', 'mine'], ['pets', 'reported']])
    );
  });
});

describe('useUploadPhotoNative', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('invalidates the pet detail, pets/mine and pets/reported queries on success', async () => {
    vi.spyOn(apiClient, 'uploadPhotoNative').mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' });

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUploadPhotoNative(), { wrapper: wrapperWithClient });

    result.current.mutate({ petId: 'pet-1', uri: 'file:///a.jpg' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([['pets', 'pet-1'], ['pets', 'mine'], ['pets', 'reported']])
    );
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
