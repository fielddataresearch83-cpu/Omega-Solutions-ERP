import { PurchaseOrdersService } from './purchase-orders.service.js';

describe('PurchaseOrdersService billable receipt quantities', () => {
  it('returns received PO quantities net of non-void supplier bill lines', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'po-1', company_id: 'company-1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: 'line-1', received_quantity: '8', billed_quantity: '5' }], rowCount: 1 }),
    };
    const memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const service = new PurchaseOrdersService(db as any, memberships as any, {} as any, {} as any);

    const result = await service.getById(
      { userId: 'buyer-1', companyId: 'company-1' } as any,
      'po-1',
    );

    expect(db.query.mock.calls[1][0]).toContain('FROM supplier_bill_items sbi');
    expect(db.query.mock.calls[1][0]).toContain("sb.status<>'void'");
    expect(result.items[0].billed_quantity).toBe('5');
    expect(Number(result.items[0].received_quantity) - Number(result.items[0].billed_quantity)).toBe(3);
  });
});
