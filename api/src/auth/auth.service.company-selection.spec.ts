import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';

describe('AuthService company-scoped identity', () => {
  let db: { query: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    db = { query: vi.fn() };
    service = new AuthService(
      db as any,
      { sign: vi.fn() } as any,
      { status: vi.fn().mockResolvedValue({ enabled: false }) } as any,
      {} as any,
    );
  });

  it('rejects an omitted company context when the user has multiple active memberships', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'user-1', email: 'multi@example.com', full_name: 'Multi User', is_active: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'company-a', name: 'Fezaton Enterprises', role: 'owner', branch_id: null },
          { id: 'company-b', name: 'The Shire', role: 'admin', branch_id: null },
        ],
        rowCount: 2,
      });

    await expect(service.getUserProfile('user-1')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('loads a session only for the explicitly selected active company', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'user-1', email: 'multi@example.com', full_name: 'Multi User', is_active: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ company_id: 'company-b', branch_id: 'branch-b', role: 'admin' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ permission: 'companies:read' }],
        rowCount: 1,
      });

    const profile = await service.getUserProfile('user-1', 'company-b');

    expect(profile).toMatchObject({
      userId: 'user-1',
      companyId: 'company-b',
      branchId: 'branch-b',
      role: 'admin',
      permissions: ['companies:read'],
    });
    expect(db.query.mock.calls[1][1]).toEqual(['user-1', 'company-b']);
    expect(db.query.mock.calls[1][0]).toContain('cm.company_id = $2::uuid');
  });

  it('rejects a company that is not an active membership of the user', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'user-1', email: 'multi@example.com', full_name: 'Multi User', is_active: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.getUserProfile('user-1', 'company-foreign')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
  it('rejects access tokens whose server-tracked session family is revoked or missing', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.assertActiveSession('family-revoked', 'user-1', 'company-a'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.query.mock.calls[0][0]).toContain('revoked_at IS NULL');
    expect(db.query.mock.calls[0][0]).toContain('expires_at > NOW()');
    expect(db.query.mock.calls[0][1]).toEqual(['family-revoked', 'user-1', 'company-a']);
  });

  it('accepts an access-token family only when a live server-side session exists', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
    await expect(service.assertActiveSession('family-active', 'user-1', 'company-a')).resolves.toBeUndefined();
  });

});
