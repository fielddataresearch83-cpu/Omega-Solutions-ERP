import { describe, expect, it, vi, afterEach } from 'vitest';
import { RedisCacheService } from './redis-cache.service.js';

const config = (values: Record<string, string | undefined> = {}) => ({
  get: (key: string) => values[key],
});

describe('RedisCacheService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs the loader when Redis is not configured', async () => {
    const cache = new RedisCacheService(config() as any);
    const loader = vi.fn().mockResolvedValue({ count: 3 });

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 3 });
    expect(loader).toHaveBeenCalledOnce();
  });

  it('uses the Upstash REST URL and token when both are configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ result: JSON.stringify({ count: 7 }) }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new RedisCacheService(config({
      UPSTASH_REDIS_REST_URL: 'https://cache.example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'rest-test-token',
    }) as any);
    const loader = vi.fn();

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 7 });
    expect(loader).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('https://cache.example.upstash.io/');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer rest-test-token');
  });

  it('derives the Upstash REST endpoint and token from REDIS_URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ result: JSON.stringify({ count: 8 }) }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new RedisCacheService(config({
      REDIS_URL: 'rediss://default:redis-test-token@cache.example.upstash.io:6379',
    }) as any);
    const loader = vi.fn();

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 8 });
    expect(loader).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('https://cache.example.upstash.io/');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer redis-test-token');
  });

  it('loads from the database and writes the result on a cache miss', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'OK' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new RedisCacheService(config({
      UPSTASH_REDIS_REST_URL: 'https://cache.example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'rest-test-token',
    }) as any);
    const loader = vi.fn().mockResolvedValue({ count: 4 });

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 4 });
    expect(loader).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toContain('"EX","10"');
  });

  it('falls back to the database when Redis is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    const cache = new RedisCacheService(config({
      UPSTASH_REDIS_REST_URL: 'https://cache.example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'rest-test-token',
    }) as any);
    const loader = vi.fn().mockResolvedValue({ count: 9 });

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 9 });
    expect(loader).toHaveBeenCalledOnce();
  });

  it('disables caching for an insecure or invalid Redis URL', async () => {
    const cache = new RedisCacheService(config({
      REDIS_URL: 'redis://cache.example.upstash.io:6379',
    }) as any);
    const loader = vi.fn().mockResolvedValue({ count: 5 });

    await expect(cache.getOrLoad('test:key', 10, loader)).resolves.toEqual({ count: 5 });
    expect(loader).toHaveBeenCalledOnce();
  });
});
