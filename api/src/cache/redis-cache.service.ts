import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type UpstashResponse<T> = { result?: T; error?: string };

@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly endpoint: string | null;
  private readonly token: string | null;

  constructor(config: ConfigService) {
    const restUrl = config.get<string>('UPSTASH_REDIS_REST_URL');
    const restToken = config.get<string>('UPSTASH_REDIS_REST_TOKEN');
    const connectionUrl = config.get<string>('REDIS_URL');

    try {
      if (restUrl && restToken) {
        const parsed = new URL(restUrl);
        if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
          throw new Error('Invalid Upstash REST URL');
        }
        this.endpoint = parsed.origin;
        this.token = restToken;
        return;
      }

      // Upstash's rediss:// connection string contains the same access token
      // used as the Bearer token by its REST API. This keeps the conventional
      // REDIS_URL Vercel setting compatible without requiring duplicate secrets.
      if (connectionUrl) {
        const parsed = new URL(connectionUrl);
        if (parsed.protocol !== 'rediss:' || !parsed.hostname || !parsed.password) {
          throw new Error('REDIS_URL must be a TLS Redis connection string');
        }
        this.endpoint = `https://${parsed.hostname}`;
        this.token = decodeURIComponent(parsed.password);
        return;
      }

      this.endpoint = null;
      this.token = null;
    } catch {
      this.endpoint = null;
      this.token = null;
      this.logger.warn('Redis caching is disabled because the Upstash configuration is invalid.');
    }
  }

  async getOrLoad<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await loader();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  private async get<T>(key: string): Promise<T | null> {
    if (!this.endpoint || !this.token) return null;
    try {
      const result = await this.command<string | null>(['GET', key]);
      return typeof result === 'string' ? JSON.parse(result) as T : null;
    } catch {
      this.logger.warn('Redis read failed; continuing with the database.');
      return null;
    }
  }

  private async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.endpoint || !this.token) return;
    try {
      await this.command<string>(['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)]);
    } catch {
      this.logger.warn('Redis write failed; continuing without the cache.');
    }
  }

  private async command<T>(command: string[]): Promise<T> {
    const response = await fetch(this.endpoint!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(1200),
    });

    if (!response.ok) throw new Error(`Redis REST request failed with status ${response.status}`);
    const payload = await response.json() as UpstashResponse<T>;
    if (payload.error) throw new Error(payload.error);
    return payload.result as T;
  }
}
