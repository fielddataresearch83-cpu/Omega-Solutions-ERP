import { InvoicesService } from './invoices.service.js';

describe('InvoicesService POS stock reversal warehouse', () => {
  it('restores a cancelled POS invoice to the warehouse used at checkout, not MAIN', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT ii.product_id')) {
          return { rows: [{ product_id: 'product-1', quantity: '2', is_service: false, cost_price: '8' }] };
        }
        if (sql.includes('SELECT warehouse_id FROM pos_sales')) {
          return { rows: [{ warehouse_id: 'branch-warehouse-2' }] };
        }
        if (sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels')) {
          return { rows: [{ quantity: '4', reserved_quantity: '0', average_unit_cost: '12' }] };
        }
        if (sql.includes('SELECT unit_cost,quantity FROM inventory_stock_movements')) {
          return { rows: [{ unit_cost: '8', quantity: '-2' }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const service = new InvoicesService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).applyInvoiceStock(client, {
      companyId: 'company-1',
      invoiceId: 'invoice-1',
      invoiceNumber: 'INV-2026-00001',
      userId: 'user-1',
      reverse: true,
    });

    expect(calls.some((call) =>
      call.sql.includes('UPDATE inventory_stock_levels SET quantity=quantity+$1') &&
      call.params?.[2] === 'branch-warehouse-2',
    )).toBe(true);
    expect(calls.some((call) =>
      call.sql.includes("SELECT id FROM warehouses WHERE company_id=$1 AND code='MAIN'"),
    )).toBe(false);
    expect(calls.some((call) =>
      call.sql.includes('INSERT INTO inventory_stock_movements') &&
      call.params?.[2] === 'branch-warehouse-2' &&
      call.params?.[5] === 8,
    )).toBe(true);
    expect(calls.some((call) =>
      call.sql.includes('SET average_unit_cost=CASE WHEN quantity+$1>0') &&
      call.params?.[1] === 8,
    )).toBe(true);
  });
});
