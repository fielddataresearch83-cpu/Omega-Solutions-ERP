import { ForbiddenException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service.js';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

describe('SuppliersService branch isolation', () => {
  const branchUser: AuthenticatedUser = {
    userId: 'staff-1',
    email: 'staff@example.test',
    fullName: 'Branch Staff',
    companyId: 'company-1',
    branchId: 'branch-1',
    role: 'staff',
    permissions: ['suppliers:read', 'suppliers:write'],
  };
  const membership = { companyId: 'company-1', branchId: 'branch-1', role: 'staff' };
  let db: { query: ReturnType<typeof vi.fn> };
  let memberships: { getMembership: ReturnType<typeof vi.fn>; getMembershipForCompany: ReturnType<typeof vi.fn> };
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: SuppliersService;

  beforeEach(() => {
    db = { query: vi.fn() };
    memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue(membership),
    };
    audit = { log: vi.fn() };
    service = new SuppliersService(
      db as unknown as DatabaseService,
      memberships as unknown as MembershipsService,
      audit as unknown as AuditService,
    );
  });

  it('blocks branch-bound members from reading or changing company-wide supplier records', async () => {
    await expect(service.list(branchUser)).rejects.toThrow(ForbiddenException);
    await expect(service.getById(branchUser, 'supplier-1')).rejects.toThrow(ForbiddenException);
    await expect(service.create(branchUser, { name: 'Supplier Ltd' })).rejects.toThrow(ForbiddenException);
    await expect(service.update(branchUser, 'supplier-1', { name: 'Changed Supplier' })).rejects.toThrow(ForbiddenException);
    await expect(service.delete(branchUser, 'supplier-1')).rejects.toThrow(ForbiddenException);

    expect(db.query).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});


describe('SuppliersService supplier history preservation', () => {
  it('archives a supplier transactionally instead of hard deleting referenced procurement history', async () => {
    const supplier = {
      id: 'supplier-1', company_id: 'company-1', name: 'Acme Supplies',
      status: 'active', is_active: true,
    };
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, company_id') && sql.includes('FOR UPDATE')) {
        return { rows: [supplier], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }) };
    const db = {
      query: vi.fn(),
      transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client)),
    };
    const memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const audit = { log: vi.fn(), logInTransaction: vi.fn().mockResolvedValue(undefined) };
    const service = new SuppliersService(db as any, memberships as any, audit as any);

    await service.delete({ userId: 'owner-1', companyId: 'company-1' } as any, 'supplier-1');

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql => sql.includes('DELETE FROM suppliers'))).toBe(false);
    expect(statements.some(sql => sql.includes("SET status='inactive',is_active=false"))).toBe(true);
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'supplier.archive', entityType: 'supplier', entityId: 'supplier-1',
      newValues: { status: 'inactive', isActive: false },
    }));
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('keeps the active flag consistent when a supplier is reactivated or made inactive', async () => {
    const existing = {
      id: 'supplier-1', company_id: 'company-1', name: 'Acme Supplies',
      status: 'inactive', is_active: false,
    };
    const updated = { ...existing, status: 'active', is_active: true };
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 }),
    };
    const memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new SuppliersService(db as any, memberships as any, audit as any);

    await service.update({ userId: 'owner-1', companyId: 'company-1' } as any, 'supplier-1', { status: 'active' } as any);

    expect(db.query.mock.calls[1][0]).toContain("is_active = CASE WHEN $1 = 'inactive' THEN false WHEN $1 = 'active' THEN true ELSE is_active END");
    expect(db.query.mock.calls[1][1]).toEqual(['active', 'supplier-1', 'company-1']);
  });
});
