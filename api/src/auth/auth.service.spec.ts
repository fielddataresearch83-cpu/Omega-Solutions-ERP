import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { verifyNeonIdentityToken } from './neon-token-verifier.js';

vi.mock('./neon-token-verifier.js', () => ({
  verifyNeonIdentityToken: vi.fn(),
}));

describe('AuthService account and invitation authorization', () => {
  const invitationToken = 'one-time-invitation-token-long-enough-for-test';
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let client: { query: ReturnType<typeof vi.fn> };
  let jwtService: { sign: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn> };
  let mfaService: { status: ReturnType<typeof vi.fn> };
  let subscriptions: { assertUserCapacity: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    (verifyNeonIdentityToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: 'neon-user-1' });

    client = { query: vi.fn() };
    db = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'neon-user-1', email: 'new.staff@example.com', emailVerified: true, name: 'New Staff' }],
        rowCount: 1,
      }),
      transaction: vi.fn((callback: (client: typeof client) => Promise<unknown>) => callback(client)),
    };
    jwtService = { sign: vi.fn().mockReturnValue('signed-test-token'), verify: vi.fn(), decode: vi.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }) };
    mfaService = { status: vi.fn().mockResolvedValue({ enabled: false }) };
    subscriptions = { assertUserCapacity: vi.fn().mockResolvedValue(undefined) };
    service = new AuthService(db as any, jwtService as any, mfaService as any, subscriptions as any);
  });

  it('creates a first-time Omega account and only the invited company membership', async () => {
    client.query
      .mockResolvedValueOnce({
        rows: [{ id: 'invite-1', company_id: 'company-2', email: 'new.staff@example.com', role: 'staff', branch_id: 'branch-2' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: 'company-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'branch-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ id: 'omega-user-1', email: 'new.staff@example.com', full_name: 'New Staff', is_active: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'membership-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await service.exchangeNeonInvitation({ token: 'verified-neon-identity-token-long-enough-for-test', invitationToken });

    expect(result).toMatchObject({
      accessToken: 'signed-test-token',
      refreshToken: 'signed-test-token',
      user: {
        userId: 'omega-user-1',
        email: 'new.staff@example.com',
        fullName: 'New Staff',
        companyId: 'company-2',
        branchId: 'branch-2',
        role: 'staff',
      },
    });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(subscriptions.assertUserCapacity).toHaveBeenCalledWith('company-2', client, true);
    expect(client.query.mock.calls[4][0]).toContain('INSERT INTO users');
    expect(client.query.mock.calls[4][1][1]).toBe('new.staff@example.com');
    expect(client.query.mock.calls[5][1]).toEqual(['omega-user-1', 'company-2']);
    expect(client.query.mock.calls[6][0]).toContain('INSERT INTO company_memberships');
    expect(client.query.mock.calls[6][1]).toEqual(['omega-user-1', 'company-2', 'branch-2', 'staff']);
    expect(client.query.mock.calls[7][0]).toContain('SET accepted_at = NOW()');
    expect(client.query.mock.calls[8][0]).toContain('INSERT INTO audit_logs');
    expect(client.query.mock.calls[8][1]).toEqual([
      'omega-user-1', 'company-2', 'branch-2', 'invite-1',
      JSON.stringify({ email: 'new.staff@example.com', role: 'staff' }),
    ]);
    expect(client.query.mock.calls.some(([sql]: [string]) => sql.includes("VALUES ($1, $2, 'owner', true)"))).toBe(false);
  });

  it('rejects invitation exchange when the reserved user quota is full', async () => {
    client.query
      .mockResolvedValueOnce({
        rows: [{ id: 'invite-1', company_id: 'company-2', email: 'new.staff@example.com', role: 'staff', branch_id: 'branch-2' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: 'company-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'branch-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ id: 'omega-user-1', email: 'new.staff@example.com', full_name: 'New Staff', is_active: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    subscriptions.assertUserCapacity.mockRejectedValueOnce(new Error('user capacity exceeded'));

    await expect(service.exchangeNeonInvitation({
      token: 'verified-neon-identity-token-long-enough-for-test',
      invitationToken,
    })).rejects.toThrow('user capacity exceeded');

    expect(subscriptions.assertUserCapacity).toHaveBeenCalledWith('company-2', client, true);
    expect(client.query.mock.calls.some(([sql]: [string]) => sql.includes('INSERT INTO company_memberships'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]: [string]) => sql.includes('SET accepted_at = NOW()'))).toBe(false);
  });

  it('does not create an Omega account when the invitation email differs from the verified Neon email', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'invite-1', company_id: 'company-2', email: 'someone-else@example.com', role: 'staff', branch_id: null }],
      rowCount: 1,
    });

    await expect(service.exchangeNeonInvitation({
      token: 'verified-neon-identity-token-long-enough-for-test',
      invitationToken,
    })).rejects.toBeInstanceOf(UnauthorizedException);

    expect(client.query).toHaveBeenCalledOnce();
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('rejects an unverified Neon identity before touching invitation data', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'neon-user-1', email: 'new.staff@example.com', emailVerified: false, name: 'New Staff' }],
      rowCount: 1,
    });

    await expect(service.exchangeNeonInvitation({
      token: 'verified-neon-identity-token-long-enough-for-test',
      invitationToken,
    })).rejects.toBeInstanceOf(UnauthorizedException);

    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('rejects an account session when its assigned branch is inactive or missing', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'user-1', email: 'staff@example.com', full_name: 'Staff', is_active: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.getUserProfile('user-1', 'company-1')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.query.mock.calls[1][0]).toContain('LEFT JOIN branches b ON b.id = cm.branch_id AND b.company_id = cm.company_id');
    expect(db.query.mock.calls[1][0]).toContain('(cm.branch_id IS NULL OR b.is_active = true)');
  });

  it('omits inactive branch memberships from the company selector', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'company-1', name: 'Example Co', role: 'staff', branch_id: 'branch-1' }],
      rowCount: 1,
    });
    const companies = await service.getActiveCompanies('user-1');
    expect(companies).toEqual([{ id: 'company-1', name: 'Example Co', role: 'staff', branchId: 'branch-1' }]);
    expect(db.query.mock.calls[0][0]).toContain('LEFT JOIN branches b ON b.id = cm.branch_id AND b.company_id = cm.company_id');
    expect(db.query.mock.calls[0][0]).toContain('(cm.branch_id IS NULL OR b.is_active = true)');
  });

});
