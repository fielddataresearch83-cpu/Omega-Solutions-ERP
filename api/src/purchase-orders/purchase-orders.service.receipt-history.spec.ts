import { PurchaseOrdersService } from './purchase-orders.service.js';

describe('PurchaseOrdersService goods receipt history', () => {
  const user = { userId: 'user-1', companyId: 'company-1', branchId: null } as any;

  it('returns company-scoped receipts with their item details', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT id FROM purchase_orders')) return { rows: [{ id: 'po-1' }] };
        if (sql.includes('FROM goods_receipts gr')) return { rows: [
          { id: 'receipt-1', company_id: 'company-1', purchase_order_id: 'po-1', receipt_value: '20.00' },
          { id: 'receipt-2', company_id: 'company-1', purchase_order_id: 'po-1', receipt_value: '10.00' },
        ] };
        if (sql.includes('FROM goods_receipt_items gri')) return { rows: [
          { id: 'item-1', goods_receipt_id: 'receipt-1', product_id: 'product-1', quantity: '2', line_value: '20.00' },
        ] };
        return { rows: [] };
      }),
    };
    const memberships = {
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const service = new PurchaseOrdersService(db as any, memberships as any, {} as any, {} as any);

    const result = await service.listReceipts(user, 'po-1');

    expect(result).toHaveLength(2);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].id).toBe('item-1');
    expect(result[1].items).toEqual([]);
    expect(queries.every(q => q.params?.includes('company-1'))).toBe(true);
  });

  it('does not reveal receipt history when the purchase order belongs to another company or is missing', async () => {
    const db = {
      query: vi.fn(async () => ({ rows: [] })),
    };
    const memberships = {
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const service = new PurchaseOrdersService(db as any, memberships as any, {} as any, {} as any);

    await expect(service.listReceipts(user, 'foreign-po')).rejects.toThrow('Purchase order not found.');
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
