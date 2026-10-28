import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./neon-token-verifier.js', () => ({
  verifyNeonIdentityToken: vi.fn().mockResolvedValue({ sub: 'neon-user-1' }),
}));
vi.mock('bcrypt', () => ({
  default: { hash: vi.fn().mockResolvedValue('opaque-password-hash') },
  hash: vi.fn().mockResolvedValue('opaque-password-hash'),
}));

import { AuthService } from './auth.service.js';

describe('AuthService Neon identity exchange intent', () => {
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = {
      query: vi.fn(),
      transaction: vi.fn(async (work: (client: { query: ReturnType<typeof vi.fn> }) => unknown) =>
        work({ query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'company-new' }] }) })),
    };
    service = new AuthService(
      db as any,
      { sign: vi.fn().mockReturnValue('signed-token'), decode: vi.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }) } as any,
      { status: vi.fn().mockResolvedValue({ enabled: false }) } as any,
      {} as any,
    );
  });

  const verifiedNeonIdentity = {
    rows: [{ id: 'neon-user-1', email: 'new@example.com', emailVerified: true, name: 'New User' }],
    rowCount: 1,
  };

  it('rejects an unknown identity on sign-in without creating an Omega user or company', async () => {
    db.query
      .mockResolvedValueOnce(verifiedNeonIdentity)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.exchangeNeonIdentity({
      token: 'a'.repeat(32), intent: 'login',
    })).rejects.toBeInstanceOf(UnauthorizedException);

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects registration intent for an email that already has an Omega account', async () => {
    db.query
      .mockResolvedValueOnce(verifiedNeonIdentity)
      .mockResolvedValueOnce({
        rows: [{ id: 'omega-user-1', email: 'new@example.com', full_name: 'Existing User', is_active: true }],
        rowCount: 1,
      });

    await expect(service.exchangeNeonIdentity({
      token: 'a'.repeat(32), intent: 'register',
    })).rejects.toBeInstanceOf(ConflictException);

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('creates a login session only for the explicitly selected active company', async () => {
    db.query
      .mockResolvedValueOnce(verifiedNeonIdentity)
      .mockResolvedValueOnce({
        rows: [{ id: 'omega-user-1', email: 'new@example.com', full_name: 'Existing User', is_active: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ company_id: 'company-b', branch_id: 'branch-b', role: 'admin' }],
        rowCount: 1,
      });

    const result = await service.exchangeNeonIdentity({
      token: 'a'.repeat(32), intent: 'login', companyId: 'company-b',
    });

    expect(result).toMatchObject({
      user: { userId: 'omega-user-1', companyId: 'company-b', branchId: 'branch-b', role: 'admin' },
    });
    expect(db.query.mock.calls[2][1]).toEqual(['omega-user-1', 'company-b']);
    expect(db.query.mock.calls[2][0]).toContain('cm.company_id = $2::uuid');
  });

  it('rejects a selected company that is not an active membership during Neon exchange', async () => {
    db.query
      .mockResolvedValueOnce(verifiedNeonIdentity)
      .mockResolvedValueOnce({
        rows: [{ id: 'omega-user-1', email: 'new@example.com', full_name: 'Existing User', is_active: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.exchangeNeonIdentity({
      token: 'a'.repeat(32), intent: 'login', companyId: 'company-foreign',
    })).rejects.toBeInstanceOf(UnauthorizedException);

    expect(db.query.mock.calls[2][1]).toEqual(['omega-user-1', 'company-foreign']);
    expect(db.transaction).not.toHaveBeenCalled();
  });

});
