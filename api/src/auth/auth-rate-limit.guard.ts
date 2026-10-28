import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  TooManyRequestsException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { DatabaseService } from '../database.service.js';

type AuthRequest = Request & { body?: Record<string, unknown> };

const LIMITS: Record<string, { limit: number; windowSeconds: number }> = {
  'POST /api/auth/login': { limit: 10, windowSeconds: 60 },
  'POST /api/auth/mfa/challenge': { limit: 10, windowSeconds: 60 },
  'POST /api/auth/neon/companies': { limit: 20, windowSeconds: 60 },
  'POST /api/auth/neon/exchange': { limit: 20, windowSeconds: 60 },
  'POST /api/auth/neon/exchange-invitation': { limit: 10, windowSeconds: 60 },
  'POST /api/auth/refresh': { limit: 30, windowSeconds: 60 },
};

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const method = request.method.toUpperCase();
    const path = (request.originalUrl || request.url).split('?')[0];
    const rule = LIMITS[`${method} ${path}`];
    if (!rule) return true;

    // Express derives req.ip from the socket unless the app explicitly trusts a
    // proxy. Do not read arbitrary X-Forwarded-For values in this guard.
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const keyHash = createHash('sha256')
      .update(`omega-auth-rate:v1\0${method}\0${path}\0${ip}`)
      .digest('hex');
    const windowSeconds = rule.windowSeconds;

    try {
      const result = await this.db.query<{ request_count: number }>(
        `INSERT INTO auth_rate_limits (key_hash, window_started_at, request_count)
         VALUES (
           $1,
           to_timestamp(floor(extract(epoch FROM NOW()) / $2) * $2),
           1
         )
         ON CONFLICT (key_hash, window_started_at)
         DO UPDATE SET
           request_count = auth_rate_limits.request_count + 1,
           updated_at = NOW()
         RETURNING request_count`,
        [keyHash, windowSeconds],
      );

      if (Number(result.rows[0]?.request_count ?? 0) > rule.limit) {
        throw new TooManyRequestsException('Too many authentication attempts. Please wait and try again.');
      }

      // Opportunistic bounded cleanup; no client-controlled values enter SQL.
      if (Number(result.rows[0]?.request_count ?? 0) === 1 && Math.random() < 0.01) {
        await this.db.query(
          "DELETE FROM auth_rate_limits WHERE updated_at < NOW() - INTERVAL '2 days'",
        );
      }
      return true;
    } catch (error) {
      if (error instanceof TooManyRequestsException) throw error;
      // Fail closed: if shared throttling is unavailable, do not expose an
      // unthrottled public authentication endpoint.
      throw new ServiceUnavailableException('Authentication protection is temporarily unavailable.');
    }
  }
}
