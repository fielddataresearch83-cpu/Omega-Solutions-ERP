import { ForbiddenException } from '@nestjs/common';
import { SupplierBillsService } from './supplier-bills.service.js';

describe('SupplierBillsService branch isolation', () => {
  const user = { userId: 'user-1', companyId: 'company-1' } as any;
  const db = { query: vi.fn(), transaction: vi.fn() };
  const memberships = {
    getMembership: vi.fn(),
    getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: 'branch-1' }),
  };
  const audit = { log: vi.fn() };
  const accounting = { ensureDefaults: vi.fn() };
  const service = new SupplierBillsService(db as any, memberships as any, audit as any, accounting as any);

  beforeEach(() => {
    vi.clearAllMocks();
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-1', branchId: 'branch-1' });
  });

  it('blocks branch-bound members from reading and writing company-wide supplier bills and payments', async () => {
    await expect(service.list(user)).rejects.toThrow(ForbiddenException);
    await expect(service.getById(user, 'bill-1')).rejects.toThrow(ForbiddenException);
    await expect(service.recordPayment(user, 'bill-1', { amount: 10, method: 'cash' } as any)).rejects.toThrow(ForbiddenException);

    expect(db.query).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(accounting.ensureDefaults).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
