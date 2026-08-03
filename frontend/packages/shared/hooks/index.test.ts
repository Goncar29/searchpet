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
  useLikeStory,
  useUnlikeStory,
  useSendMessageTo,
  useNearbyReports,
  useBlockStatus,
  useMarkPetAsFound,
  useNearbyVets,
  useUpdateMe,
  useUploadProfilePhoto,
  useUploadProfilePhotoNative,
  useUnreadCount,
  useGetMe,
  UNREAD_COUNT_KEY,
} from './index';
import type { Pet, SuccessStory, StoryListResponse, Message, Report, User } from '../types';

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

  it('invalidates pets, pets/:id, pets/mine, reports, and stats queries on success', async () => {
    vi.spyOn(apiClient, 'publishPetLost').mockResolvedValue({ ...mockPet, status: 'lost' });

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => usePublishLost(), { wrapper: wrapperWithClient });

    result.current.mutate({ id: 'pet-1', data: { latitude: -34.9, longitude: -56.1 } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    // ['stats'] refreshes the home "searches started" lifetime counter.
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([['pets'], ['pets', 'pet-1'], ['pets', 'mine'], ['reports'], ['stats']])
    );
    expect(invalidatedKeys).toHaveLength(5);
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

  it('invalidates pets, pets/:id, pets/mine, reports, and stats queries on success', async () => {
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
    // ['stats'] refreshes the home "searches started" lifetime counter.
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([['pets'], ['pets', 'mine'], ['pets', mockPet.id], ['reports'], ['stats']])
    );
    expect(invalidatedKeys).toHaveLength(5);
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

const mockStory: SuccessStory = {
  id: 'story-1',
  pet_id: 'pet-1',
  user_id: 'user-1',
  title: 'Volvió a casa',
  body: 'Después de una semana...',
  like_count: 0,
  liked_by_me: false,
  featured: false,
  pet_name: 'Firulais',
  user_name: 'Ana',
  created_at: '2026-01-01T00:00:00Z',
};

describe('useLikeStory', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reconciles like_count and liked_by_me from the server response on success', async () => {
    vi.spyOn(apiClient, 'likeStory').mockResolvedValue({ like_count: 5, liked: true });

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    queryClient.setQueryData<StoryListResponse>(['stories', undefined], [mockStory]);

    const { result } = renderHook(() => useLikeStory(), { wrapper: wrapperWithClient });

    result.current.mutate('story-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData<StoryListResponse>(['stories', undefined]);
    expect(cached?.[0].like_count).toBe(5);
    expect(cached?.[0].liked_by_me).toBe(true);
  });

  it('rolls back the optimistic update on error', async () => {
    vi.spyOn(apiClient, 'likeStory').mockRejectedValue(new Error('boom'));

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    queryClient.setQueryData<StoryListResponse>(['stories', undefined], [mockStory]);

    const { result } = renderHook(() => useLikeStory(), { wrapper: wrapperWithClient });

    result.current.mutate('story-1');

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<StoryListResponse>(['stories', undefined]);
    expect(cached?.[0].like_count).toBe(0);
    expect(cached?.[0].liked_by_me).toBe(false);
  });
});

describe('useUnlikeStory', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reconciles like_count and liked_by_me from the server response on success', async () => {
    vi.spyOn(apiClient, 'unlikeStory').mockResolvedValue({ like_count: 0, liked: false });

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    queryClient.setQueryData<StoryListResponse>(['stories', undefined], [
      { ...mockStory, like_count: 1, liked_by_me: true },
    ]);

    const { result } = renderHook(() => useUnlikeStory(), { wrapper: wrapperWithClient });

    result.current.mutate('story-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData<StoryListResponse>(['stories', undefined]);
    expect(cached?.[0].like_count).toBe(0);
    expect(cached?.[0].liked_by_me).toBe(false);
  });

  it('rolls back the optimistic update on error', async () => {
    vi.spyOn(apiClient, 'unlikeStory').mockRejectedValue(new Error('boom'));

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    queryClient.setQueryData<StoryListResponse>(['stories', undefined], [
      { ...mockStory, like_count: 1, liked_by_me: true },
    ]);

    const { result } = renderHook(() => useUnlikeStory(), { wrapper: wrapperWithClient });

    result.current.mutate('story-1');

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<StoryListResponse>(['stories', undefined]);
    expect(cached?.[0].like_count).toBe(1);
    expect(cached?.[0].liked_by_me).toBe(true);
  });
});

// ============================================================
// useSendMessageTo — optimistic insert + rollback + onSettled.
// Mirrors the useLikeStory optimistic pattern but for the messages cache.
// ============================================================
describe('useSendMessageTo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const serverMessage: Message = {
    id: 'msg-real-1',
    sender_id: 'me',
    receiver_id: 'them',
    content: 'hola',
    is_read: false,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('optimistically appends a temp message to the conversation before the request resolves', async () => {
    // Never resolves during the assertion window so we observe the optimistic state.
    vi.spyOn(apiClient, 'sendMessageTo').mockReturnValue(new Promise(() => {}));

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    queryClient.setQueryData<Message[]>(['messages', 'them'], []);

    const { result } = renderHook(() => useSendMessageTo(), { wrapper: wrapperWithClient });

    result.current.mutate({ receiverID: 'them', senderID: 'me', content: 'hola' });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Message[]>(['messages', 'them']);
      expect(cached).toHaveLength(1);
    });
    const cached = queryClient.getQueryData<Message[]>(['messages', 'them']);
    expect(cached?.[0].content).toBe('hola');
    expect(cached?.[0].sender_id).toBe('me');
    expect(cached?.[0].id).toMatch(/^temp-/);
  });

  it('rolls back to the previous conversation on error', async () => {
    vi.spyOn(apiClient, 'sendMessageTo').mockRejectedValue(new Error('boom'));

    const existing: Message = { ...serverMessage, id: 'msg-existing', content: 'previo' };
    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    queryClient.setQueryData<Message[]>(['messages', 'them'], [existing]);

    const { result } = renderHook(() => useSendMessageTo(), { wrapper: wrapperWithClient });

    result.current.mutate({ receiverID: 'them', senderID: 'me', content: 'hola' });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<Message[]>(['messages', 'them']);
    expect(cached).toEqual([existing]);
  });

  it('invalidates the conversation and the conversation list on settle', async () => {
    vi.spyOn(apiClient, 'sendMessageTo').mockResolvedValue(serverMessage);

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSendMessageTo(), { wrapper: wrapperWithClient });

    result.current.mutate({ receiverID: 'them', senderID: 'me', content: 'hola' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toEqual(expect.arrayContaining([['messages', 'them'], ['messages']]));
  });
});

// ============================================================
// useNearbyReports — km->m radius conversion + response reshaping.
// ============================================================
describe('useNearbyReports', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockReport: Report = {
    id: 'rep-1',
    pet_id: 'pet-1',
    reporter_id: 'me',
    status: 'sighting',
    latitude: -34.9,
    longitude: -56.1,
    is_verified: false,
    created_at: '2026-01-01T00:00:00Z',
  } as Report;

  it('converts the radius from km to meters when calling the API', async () => {
    const spy = vi.spyOn(apiClient, 'getNearbyReports').mockResolvedValue({ data: [], radius_used: 5000 });

    const { result } = renderHook(() => useNearbyReports(-34.9, -56.1, 5), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ lat: -34.9, lng: -56.1, radius: 5000 });
  });

  it('unwraps response.data into data and exposes radiusUsed', async () => {
    vi.spyOn(apiClient, 'getNearbyReports').mockResolvedValue({ data: [mockReport], radius_used: 5000 });

    const { result } = renderHook(() => useNearbyReports(-34.9, -56.1, 5), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([mockReport]);
    expect(result.current.radiusUsed).toBe(5000);
  });

  it('does not fire the query when lat/lng are falsy', async () => {
    const spy = vi.spyOn(apiClient, 'getNearbyReports').mockResolvedValue({ data: [], radius_used: 0 });

    const { result } = renderHook(() => useNearbyReports(0, 0, 5), { wrapper });

    // enabled is false -> query stays idle, queryFn never runs.
    expect(result.current.fetchStatus).toBe('idle');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ============================================================
// useBlockStatus — reshaping with a safe default.
// ============================================================
describe('useBlockStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns is_blocked from the server response', async () => {
    vi.spyOn(apiClient, 'getBlockStatus').mockResolvedValue({ is_blocked: true });

    const { result } = renderHook(() => useBlockStatus('user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBlocked).toBe(true);
  });

  it('defaults isBlocked to false while no data is available', () => {
    vi.spyOn(apiClient, 'getBlockStatus').mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useBlockStatus('user-1'), { wrapper });

    expect(result.current.isBlocked).toBe(false);
  });

  it('stays disabled (and defaults to false) when userId is undefined', () => {
    const spy = vi.spyOn(apiClient, 'getBlockStatus').mockResolvedValue({ is_blocked: true });

    const { result } = renderHook(() => useBlockStatus(undefined), { wrapper });

    expect(result.current.isBlocked).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('exposes isError when the fetch fails, with isBlocked still defaulting to false', async () => {
    vi.spyOn(apiClient, 'getBlockStatus').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useBlockStatus('user-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // A failed check never pretends the user is blocked.
    expect(result.current.isBlocked).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});

// ============================================================
// useMarkPetAsFound — seeds the pet detail cache + cross-entity invalidation.
// ============================================================
describe('useMarkPetAsFound', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const foundPet: Pet = { ...mockPet, id: 'pet-9', status: 'found' } as Pet;

  it('writes the updated pet into the pet-detail cache on success', async () => {
    vi.spyOn(apiClient, 'markPetAsFound').mockResolvedValue(foundPet);

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const { result } = renderHook(() => useMarkPetAsFound(), { wrapper: wrapperWithClient });

    result.current.mutate('pet-9');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData<Pet>(['pets', 'pet-9'])).toEqual(foundPet);
  });

  it('invalidates the pets list, reports, and stats so the map and home counter reflect the new status', async () => {
    vi.spyOn(apiClient, 'markPetAsFound').mockResolvedValue(foundPet);

    const { queryClient, wrapper: wrapperWithClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useMarkPetAsFound(), { wrapper: wrapperWithClient });

    result.current.mutate('pet-9');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    // ['stats'] refreshes the home "pets reunited" lifetime counter.
    expect(invalidatedKeys).toEqual(expect.arrayContaining([['pets'], ['reports'], ['stats']]));
  });
});

// ============================================================
// useNearbyVets — passes radius in meters, gated by enabled.
// ============================================================
describe('useNearbyVets', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls getNearbyVets with lat/lng/radius and exposes the array', async () => {
    const mockVet = {
      id: 'v1', name: 'Puntovet', latitude: -34.9, longitude: -56.1, distance_meters: 120,
    };
    const spy = vi.spyOn(apiClient, 'getNearbyVets').mockResolvedValue([mockVet]);

    const { result } = renderHook(() => useNearbyVets(-34.9, -56.1, 5000, true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ lat: -34.9, lng: -56.1, radius: 5000 });
    expect(result.current.data).toEqual([mockVet]);
  });

  it('does not fire when disabled', async () => {
    const spy = vi.spyOn(apiClient, 'getNearbyVets').mockResolvedValue([]);

    renderHook(() => useNearbyVets(-34.9, -56.1, 5000, false), { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});

// ============================================================
// Hooks que escriben la cache a mano, y el invariante de la clave del badge.
//
// Estos NO son passthrough de React Query: escriben con setQueryData usando una
// clave hardcodeada que tiene que coincidir con la que lee useGetMe, e invalidan
// prefijos elegidos por un motivo escrito. Si esa correspondencia se rompe, no
// hay error: la UI muestra datos viejos y nadie se entera.
// ============================================================

const mockUser: User = {
  id: 'user-1',
  name: 'Carlos',
  email: 'carlos@example.com',
  phone: '',
} as User;

describe('useUpdateMe', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lo que escribe el mutation es lo que LEE useGetMe', async () => {
    const viejo = { ...mockUser, name: 'Carlos viejo' };
    const nuevo = { ...mockUser, name: 'Carlos nuevo' };
    vi.spyOn(apiClient, 'getMe').mockResolvedValue(viejo);
    vi.spyOn(apiClient, 'updateMe').mockResolvedValue(nuevo);
    const { wrapper: w } = createWrapperWithClient();

    // Se renderizan LOS DOS hooks contra el mismo QueryClient. Comparar la
    // cache contra un literal ['me'] escrito a mano no probaba nada: fijaba el
    // escritor contra una copia de si mismo, y renombrar la clave de useGetMe
    // dejaba todo verde mientras el perfil mostraba datos viejos.
    const { result } = renderHook(() => ({ update: useUpdateMe(), me: useGetMe() }), { wrapper: w });

    await waitFor(() => expect(result.current.me.data).toEqual(viejo));

    result.current.update.mutate({ name: 'Carlos nuevo' });

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.me.data).toEqual(nuevo));
  });

  it('invalida pets y reports — el telefono viejo vive embebido en esos payloads', async () => {
    vi.spyOn(apiClient, 'updateMe').mockResolvedValue(mockUser);
    const { queryClient, wrapper: w } = createWrapperWithClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateMe(), { wrapper: w });
    result.current.mutate({ name: 'Carlos' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Estas dos invalidaciones parecen redundantes y no lo son: el nombre y el
    // telefono del dueño viajan DENTRO de las mascotas y los reportes. Si
    // alguien las borra, quien se borra el telefono lo sigue viendo en sus
    // propias publicaciones, sin ningun sintoma de error.
    // Se compara el filtro ENTERO, no solo queryKey: con `exact: true` la
    // invalidacion dejaria de alcanzar ['pets','mine'] y ['pets', id], que son
    // justo las vistas donde el dueño ve su propio telefono viejo.
    const filtros = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(filtros).toContain(JSON.stringify({ queryKey: ['pets'] }));
    expect(filtros).toContain(JSON.stringify({ queryKey: ['reports'] }));
  });
});

describe('useUploadProfilePhoto', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('la foto nueva llega a useGetMe', async () => {
    const sinFoto: User = { ...mockUser, profile_photo_url: undefined };
    const conFoto: User = { ...mockUser, profile_photo_url: 'https://cdn/x.webp' };
    vi.spyOn(apiClient, 'getMe').mockResolvedValue(sinFoto);
    vi.spyOn(apiClient, 'uploadProfilePhoto').mockResolvedValue(conFoto);
    const { wrapper: w } = createWrapperWithClient();

    const { result } = renderHook(() => ({ up: useUploadProfilePhoto(), me: useGetMe() }), { wrapper: w });
    await waitFor(() => expect(result.current.me.data?.profile_photo_url).toBeUndefined());

    result.current.up.mutate(new File([''], 'foto.jpg'));

    await waitFor(() => expect(result.current.up.isSuccess).toBe(true));
    // Se afirma el CAMPO, no el objeto entero: comparar contra el mock completo
    // pasaba igual con un mockUser sin foto.
    await waitFor(() => expect(result.current.me.data?.profile_photo_url).toBe('https://cdn/x.webp'));
  });
});

describe('useUploadProfilePhotoNative', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('la foto nueva llega a useGetMe', async () => {
    const sinFoto: User = { ...mockUser, profile_photo_url: undefined };
    const conFoto: User = { ...mockUser, profile_photo_url: 'https://cdn/y.webp' };
    vi.spyOn(apiClient, 'getMe').mockResolvedValue(sinFoto);
    vi.spyOn(apiClient, 'uploadProfilePhotoNative').mockResolvedValue(conFoto);
    const { wrapper: w } = createWrapperWithClient();

    const { result } = renderHook(() => ({ up: useUploadProfilePhotoNative(), me: useGetMe() }), { wrapper: w });
    await waitFor(() => expect(result.current.me.data?.profile_photo_url).toBeUndefined());

    result.current.up.mutate('file:///tmp/foto.jpg');

    await waitFor(() => expect(result.current.up.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.me.data?.profile_photo_url).toBe('https://cdn/y.webp'));
  });
});

describe('useUnreadCount', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('su clave vive bajo el prefijo messages, asi las invalidaciones existentes lo refrescan', async () => {
    const getUnread = vi.spyOn(apiClient, 'getUnreadCount').mockResolvedValue({ count: 3 });
    const { queryClient, wrapper: w } = createWrapperWithClient();

    const { result } = renderHook(() => useUnreadCount(), { wrapper: w });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getUnread).toHaveBeenCalledTimes(1);

    // El OTRO escritor de esta clave es el envelope badge_update del WebSocket
    // en MainLayout. Los dos usan UNREAD_COUNT_KEY, asi que renombrarla mueve
    // las dos puntas a la vez; mientras el literal estaba duplicado, cambiarlo
    // de un lado dejaba el badge sin actualizarse en vivo y todo en verde.
    expect(queryClient.getQueryData(UNREAD_COUNT_KEY)).toEqual({ count: 3 });

    // El hook es un useQuery pelado: lo que se prueba aca NO es React Query,
    // es la RELACION entre su clave y el prefijo que invalidan los demas hooks
    // de mensajeria. Si la clave dejara de colgar de ['messages'], el badge de
    // no leidos se quedaria viejo despues de cada mensaje, en silencio.
    await queryClient.invalidateQueries({ queryKey: ['messages'] });

    await waitFor(() => expect(getUnread).toHaveBeenCalledTimes(2));
  });
});
