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
