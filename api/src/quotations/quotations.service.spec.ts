import { ForbiddenException } from '@nestjs/common';
import { QuotationsService } from './quotations.service.js';

describe('QuotationsService branch isolation', () => {
  const user = { userId: 'user-1' } as any;
  let service: QuotationsService;
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let memberships: { getMembership: ReturnType<typeof vi.fn>; getMembershipForCompany: ReturnType<typeof vi.fn> };
  let audit: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      transaction: vi.fn(),
    };
    memberships = {
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: 'branch-1' }),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: 'branch-1' }),
    };
    audit = { log: vi.fn() };
    service = new QuotationsService(db as any, memberships as any, audit as any);
  });

  it('blocks branch-bound members from reading or mutating company-wide quotations', async () => {
    await expect(service.list(user)).rejects.toThrow(ForbiddenException);
    await expect(service.getById(user, 'quotation-1')).rejects.toThrow(ForbiddenException);
    await expect(service.create(user, {
      customerId: 'customer-1',
      issueDate: '2026-10-26',
      validUntil: '2026-11-26',
      items: [{ productId: 'product-1', quantity: 1 }],
    } as any)).rejects.toThrow(ForbiddenException);
    await expect(service.updateStatus(user, 'quotation-1', 'sent')).rejects.toThrow(ForbiddenException);

    expect(db.query).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('serializes quotation status transitions under a row lock', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'quotation-1', company_id: 'company-1', status: 'draft' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };
    db.transaction.mockImplementation(async (callback: (client: any) => Promise<unknown>) => callback(client));
    memberships.getMembershipForCompany.mockResolvedValue({ companyId: 'company-1', branchId: null });
    vi.spyOn(service, 'getById').mockResolvedValue({ id: 'quotation-1', status: 'sent' } as any);

    await service.updateStatus({ userId: 'user-1', companyId: 'company-1' } as any, 'quotation-1', 'sent');

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[1][0]).toContain('UPDATE quotations SET status');
    expect(audit.log).toHaveBeenCalledOnce();
  });

});
