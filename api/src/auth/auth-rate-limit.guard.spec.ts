import { ExecutionContext, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';

function context(path = '/api/auth/login', ip = '203.0.113.10'): ExecutionContext {
  const request = {
    method: 'POST',
    originalUrl: path,
    url: path,
    ip,
    socket: { remoteAddress: ip },
    body: {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthRateLimitGuard', () => {
  it('uses an atomic shared database counter and permits requests within the limit', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ request_count: 1 }] }) };
    const guard = new AuthRateLimitGuard(db as any);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(db.query).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[0][0]).toContain('ON CONFLICT');
    expect(db.query.mock.calls[0][0]).toContain('request_count = auth_rate_limits.request_count + 1');
    expect(db.query.mock.calls[0][1][0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects requests above the endpoint limit', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ request_count: 11 }] }) };
    const guard = new AuthRateLimitGuard(db as any);
    await expect(guard.canActivate(context())).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('fails closed if shared rate-limit storage is unavailable', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const guard = new AuthRateLimitGuard(db as any);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });


  it.each([
    ['/api/auth/mfa/enroll', 6],
    ['/api/auth/mfa/confirm', 11],
    ['/api/auth/mfa/disable', 6],
  ])('throttles repeated MFA security action %s', async (path, requestCount) => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ request_count: requestCount }] }) };
    const guard = new AuthRateLimitGuard(db as any);
    await expect(guard.canActivate(context(path))).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('does not throttle routes outside the public auth rules', async () => {
    const db = { query: vi.fn() };
    const guard = new AuthRateLimitGuard(db as any);
    await expect(guard.canActivate(context('/api/products'))).resolves.toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });
});
