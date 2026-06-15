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
