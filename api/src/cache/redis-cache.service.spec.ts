import { describe, expect, it, vi, afterEach } from 'vitest';
import { RedisCacheService } from './redis-cache.service.js';

const config = (url?: string, token?: string) => ({
  get: (key: string) => key === 'UPSTASH_REDIS_REST_URL' ? url
    : key === 'UPSTASH_REDIS_REST_TOKEN' ? token : undefined,
});

describe('RedisCacheService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs the loader when Upstash REST is not configured', async () => {
    const cache = new RedisCacheService(config() as any);
    const loader = vi.fn().mockResolvedValue({ count: 3 });

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 3 });
    expect(loader).toHaveBeenCalledOnce();
  });

  it('returns cached JSON without calling the loader', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ result: JSON.stringify({ count: 7 }) }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new RedisCacheService(config('https://cache.example.upstash.io', 'rest-test-token') as any);
    const loader = vi.fn();

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 7 });
    expect(loader).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer rest-test-token');
  });

  it('loads from the database and writes the result on a cache miss', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'OK' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new RedisCacheService(config('https://cache.example.upstash.io', 'rest-test-token') as any);
    const loader = vi.fn().mockResolvedValue({ count: 4 });

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 4 });
    expect(loader).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toContain('"EX","10"');
  });

  it('falls back to the database when Redis is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    const cache = new RedisCacheService(config('https://cache.example.upstash.io', 'rest-test-token') as any);
    const loader = vi.fn().mockResolvedValue({ count: 9 });

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 9 });
    expect(loader).toHaveBeenCalledOnce();
  });

  it('disables caching for a non-HTTPS REST endpoint', async () => {
    const cache = new RedisCacheService(config('http://cache.example.upstash.io', 'rest-test-token') as any);
    const loader = vi.fn().mockResolvedValue({ count: 5 });

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 5 });
    expect(loader).toHaveBeenCalledOnce();
  });
});
