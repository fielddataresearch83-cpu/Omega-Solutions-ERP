import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service.js';

describe('AuthService refresh-token rotation', () => {
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let client: { query: ReturnType<typeof vi.fn> };
  let jwt: { sign: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn>; decode: ReturnType<typeof vi.fn> };
  let service: AuthService;
  const oldToken = 'signed-old-refresh-token';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    client = { query: vi.fn() };
    db = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      transaction: vi.fn((work: (client: typeof client) => Promise<unknown>) => work(client)),
    };
    jwt = {
      sign: vi.fn().mockReturnValue('signed-next-refresh-token'),
      verify: vi.fn().mockReturnValue({ sub: 'user-1', email: 'user@example.com', companyId: 'company-1', branchId: null, role: 'owner', mfaVerified: true, jti: 'jti-old', familyId: 'family-1' }),
      decode: vi.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    };
    service = new AuthService(db as any, jwt as any, { status: vi.fn().mockResolvedValue({ enabled: false }) } as any, {} as any);
    vi.spyOn(service, 'getUserProfile').mockResolvedValue({
      userId: 'user-1', email: 'user@example.com', fullName: 'User', companyId: 'company-1',
      branchId: null, role: 'owner', permissions: [], mfaVerified: true,
    });
  });

  it('atomically consumes the old token and persists its replacement in the same family', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ token_family_id: 'family-1', used_at: null, revoked_at: null, expires_at: new Date(Date.now() + 3600000) }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const result = await service.refresh({ refreshToken: oldToken });
    expect(result).toEqual({ accessToken: 'signed-next-refresh-token', refreshToken: 'signed-next-refresh-token' });
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[1][0]).toContain('SET used_at = NOW()');
    expect(client.query.mock.calls[2][0]).toContain('INSERT INTO auth_refresh_tokens');
    expect(client.query.mock.calls[2][1]).toEqual(expect.arrayContaining(['family-1', 'user-1', 'company-1']));
    expect(createHash('sha256').update(oldToken).digest('hex')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('revokes the entire family when an already-consumed refresh token is replayed', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ token_family_id: 'family-1', used_at: new Date(), revoked_at: null, expires_at: new Date(Date.now() + 3600000) }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(service.refresh({ refreshToken: oldToken })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(client.query.mock.calls[1][0]).toContain('WHERE token_family_id = $1');
    expect(client.query.mock.calls[1][0]).toContain('revoked_at = COALESCE');
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('rejects refresh tokens without a registered token ID and family ID', async () => {
    jwt.verify.mockReturnValueOnce({ sub: 'user-1', companyId: 'company-1' });
    await expect(service.refresh({ refreshToken: oldToken })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
