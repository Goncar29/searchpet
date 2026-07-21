// ============================================================
// Tests for APIClient.searchPetsByImage / searchPetsByImageNative
// Runner: Vitest — global fetch is mocked per test.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIClient, ApiError } from './client';

describe('APIClient image search', () => {
  let client: APIClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new APIClient('http://api.test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('searchPetsByImage', () => {
    it('POSTs multipart form data with field "photo" and returns results', async () => {
      const mockResponse = {
        results: [
          { pet_id: 'p1', name: 'Firulais', type: 'perro', photo_url: 'https://x/p1.jpg', similarity: 0.87, owner_id: 'u1' },
        ],
      };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const file = new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await client.searchPetsByImage(file);

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://api.test/api/pets/search/image');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('photo')).toBe(file);
    });

    it('sends Authorization header when a token is set', async () => {
      client.setToken('test-jwt');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      const file = new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' });
      await client.searchPetsByImage(file);

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers['Authorization']).toBe('Bearer test-jwt');
    });

    it('throws ApiError with code "image_search_unavailable" on 503', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ code: 'image_search_unavailable', message: 'Image search is temporarily unavailable' }),
      });

      const file = new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' });

      await expect(client.searchPetsByImage(file)).rejects.toBeInstanceOf(ApiError);
      await expect(client.searchPetsByImage(file)).rejects.toMatchObject({
        code: 'image_search_unavailable',
        status: 503,
      });
    });

    it('clears the token and throws on 401', async () => {
      client.setToken('expired-token');
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ code: 'unauthorized', message: 'Token expired' }),
      });

      const file = new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' });

      await expect(client.searchPetsByImage(file)).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    });
  });

  describe('searchPetsByImageNative', () => {
    it('POSTs multipart form data with a { uri, name, type } object for field "photo"', async () => {
      const mockResponse = { results: [] };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const appendSpy = vi.spyOn(FormData.prototype, 'append');
      const uri = 'file:///tmp/photo.jpg';
      const result = await client.searchPetsByImageNative(uri);

      expect(result).toEqual(mockResponse);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://api.test/api/pets/search/image');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect(appendSpy).toHaveBeenCalledWith('photo', { uri, name: 'photo.jpg', type: 'image/jpeg' });
      appendSpy.mockRestore();
    });

    it('infers content type from the file extension', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      const appendSpy = vi.spyOn(FormData.prototype, 'append');
      await client.searchPetsByImageNative('file:///tmp/photo.png');

      expect(appendSpy).toHaveBeenCalledWith('photo', expect.objectContaining({ type: 'image/png' }));
      appendSpy.mockRestore();
    });

    it('throws ApiError on a non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ code: 'image_search_unavailable', message: 'unavailable' }),
      });

      await expect(client.searchPetsByImageNative('file:///tmp/photo.jpg')).rejects.toMatchObject({
        code: 'image_search_unavailable',
        status: 503,
      });
    });
  });
});

describe('APIClient.publishPetLost', () => {
  let client: APIClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new APIClient('http://api.test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /api/pets/:id/publish-lost with lat/lng/note and returns the updated pet', async () => {
    const mockPet = { id: 'pet-1', status: 'lost' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockPet,
    });

    const result = await client.publishPetLost('pet-1', {
      latitude: -34.9011,
      longitude: -56.1645,
      note: 'Visto cerca de la plaza',
    });

    expect(result).toEqual(mockPet);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/pets/pet-1/publish-lost');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      latitude: -34.9011,
      longitude: -56.1645,
      note: 'Visto cerca de la plaza',
    });
  });

  it('throws ApiError with {code,message} on 403 (non-owner)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ code: 'forbidden', message: 'No sos el dueño de esta mascota' }),
    });

    await expect(
      client.publishPetLost('pet-1', { latitude: -34.9, longitude: -56.1 })
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });
});

describe('APIClient story likes', () => {
  let client: APIClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new APIClient('http://api.test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('likeStory', () => {
    it('POSTs to /api/stories/:id/like and returns { like_count, liked }', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ like_count: 1, liked: true }),
      });

      const result = await client.likeStory('story-1');

      expect(result).toEqual({ like_count: 1, liked: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://api.test/api/stories/story-1/like');
      expect(init.method).toBe('POST');
    });
  });

  describe('unlikeStory', () => {
    it('DELETEs /api/stories/:id/like and returns { like_count, liked }', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ like_count: 0, liked: false }),
      });

      const result = await client.unlikeStory('story-1');

      expect(result).toEqual({ like_count: 0, liked: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://api.test/api/stories/story-1/like');
      expect(init.method).toBe('DELETE');
    });
  });
});

describe('APIClient.getOrCreateShareLink (auth-aware share for finders)', () => {
  let client: APIClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new APIClient('http://api.test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const link = { share_token: 'tok', share_url: 'http://api.test/share/tok' };

  it('uses the PUBLIC endpoint when logged out (no token)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => link });

    const result = await client.getOrCreateShareLink('pet-1');

    expect(result).toEqual(link);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/pets/pet-1/share-link');
    expect(init.method).toBe('POST');
  });

  it('uses the PROTECTED endpoint first when authenticated (owner keeps share.created)', async () => {
    client.setToken('jwt');
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => link });

    const result = await client.getOrCreateShareLink('pet-1');

    expect(result).toEqual(link);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/share/generate/pet-1');
  });

  it('falls back to the PUBLIC endpoint when the protected call is forbidden (logged-in non-owner)', async () => {
    client.setToken('jwt');
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ code: 'not_pet_owner', message: 'no' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => link });

    const result = await client.getOrCreateShareLink('pet-1');

    expect(result).toEqual(link);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/share/generate/pet-1');
    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/api/pets/pet-1/share-link');
  });
});

describe('APIClient request timeout', () => {
  let client: APIClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new APIClient('http://test.local');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('throws ApiError(request_timeout) when the request exceeds the ceiling', async () => {
    // fetch never settles on its own — it only rejects when the signal aborts,
    // mirroring a real hung connection.
    const fetchMock = vi.fn(
      (_input: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = client.getStats();
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      code: 'request_timeout',
      status: 0,
    });

    // Fast-forward past the 45s ceiling → setTimeout fires → controller.abort()
    // → fetch rejects with AbortError → wrapper throws ApiError.
    await vi.advanceTimersByTimeAsync(45000);
    await assertion;
  });

  it('resolves normally when fetch responds before the ceiling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ total_pets: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await expect(client.getStats()).resolves.toEqual({ total_pets: 0 });
  });

  it('re-throws a non-abort fetch error unchanged', async () => {
    const netErr = new TypeError('Failed to fetch');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw netErr;
      }),
    );

    await expect(client.getStats()).rejects.toBe(netErr);
  });

  it('getImpactStats resolves the impact payload', async () => {
    const payload = {
      totals: {
        pets_reunited: 2,
        searches_started: 4,
        total_users: 1,
        total_pets: 1,
        active_searches: 1,
        reunion_rate: 0.5,
      },
      reunions_by_month: [{ month: '2026-07', count: 2 }],
      new_users_by_month: [{ month: '2026-07', count: 1 }],
      reports_by_month: [{ month: '2026-07', count: 3 }],
      pets_by_type: [{ type: 'perro', count: 1 }],
      moderation: {
        abuse_pending: 2,
        abuse_resolved: 1,
        abuse_dismissed: 0,
        foster_homes_pending: 0,
        shelters_pending: 3,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await expect(client.getImpactStats()).resolves.toEqual(payload);
  });
});
