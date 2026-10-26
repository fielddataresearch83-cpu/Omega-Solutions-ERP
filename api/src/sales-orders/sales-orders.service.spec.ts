import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service.js';

describe('SalesOrdersService inventory fulfilment', () => {
  const user = { userId: 'user-1' } as any;
  let service: SalesOrdersService;
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let client: { query: ReturnType<typeof vi.fn> };
  let memberships: { getMembership: ReturnType<typeof vi.fn>; getMembershipForCompany: ReturnType<typeof vi.fn> };
  let audit: { log: ReturnType<typeof vi.fn> };
  let accounting: { ensureDefaults: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    memberships = {
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1' }),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-2' }),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    accounting = { ensureDefaults: vi.fn().mockResolvedValue(undefined) };
    client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM sales_orders WHERE id = $1') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 'order-1', status: 'processing', order_number: 'SO-2026-00001' }], rowCount: 1 };
        }
        if (sql.includes('FROM warehouses WHERE id = $1')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
        if (sql.includes('FROM sales_order_items soi')) return { rows: [{ product_id: 'product-1', quantity: '2', is_service: false, is_active: true, cost_price: '4.5', product_name: 'Widget' }], rowCount: 1 };
        if (sql.includes('FROM inventory_stock_levels')) return { rows: [{ quantity: '10', reserved_quantity: '1', average_unit_cost: '3.75' }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entry_sequences')) return { rows: [{ next_number: 1 }], rowCount: 1 };
        if (sql.includes('FROM chart_of_accounts')) return { rows: [{ id: 'account-inventory', system_code: 'inventory' }, { id: 'account-cogs', system_code: 'purchases_expense' }], rowCount: 2 };
        if (sql.includes('INSERT INTO journal_entries')) return { rows: [{ id: 'journal-1' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    };
    db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM sales_orders so')) return { rows: [{ id: 'order-1', status: 'fulfilled', order_number: 'SO-2026-00001', items: [] }], rowCount: 1 };
        if (sql.includes('FROM sales_order_items WHERE')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      }),
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(client)),
    };
    service = new SalesOrdersService(db as any, memberships as any, audit as any, accounting as any);
  });

  it('uses the company selected in the authenticated context for sales-order reads', async () => {
    await service.list({ ...user, companyId: 'company-2' } as any);

    expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-1', 'company-2');
    expect(memberships.getMembership).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE so.company_id = $1'), ['company-2']);
  });

  it('blocks branch-bound members from company-wide sales orders before querying data', async () => {
    memberships.getMembership.mockResolvedValue({ companyId: 'company-1', branchId: 'branch-1' });

    await expect(service.list(user)).rejects.toThrow(ForbiddenException);
    await expect(service.getById(user, 'order-1')).rejects.toThrow(ForbiddenException);
    await expect(service.updateStatus(user, 'order-1', 'cancelled')).rejects.toThrow(ForbiddenException);

    expect(db.query).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('deducts available stock, records an issue movement, and marks the order fulfilled atomically', async () => {
    await service.updateStatus(user, 'order-1', 'fulfilled', 'warehouse-1');
    const calls = client.query.mock.calls as unknown as [string, unknown[]?][];
    expect(calls.some(([sql, params]) => sql.includes('UPDATE inventory_stock_levels SET quantity = quantity -') && params?.[0] === 2)).toBe(true);
    expect(calls.some(([sql, params]) => sql.includes('INSERT INTO inventory_stock_movements') && params?.[3] === -2 && params?.[4] === 3.75 && params?.[5] === 'SO-2026-00001')).toBe(true);
    expect(calls.some(([sql, params]) => sql.includes('UPDATE sales_orders SET status') && params?.[0] === 'fulfilled')).toBe(true);
    expect(calls.some(([sql, params]) => sql.includes('INSERT INTO journal_entry_lines') && params?.[3] === 7.5 && params?.[4] === 'account-inventory')).toBe(true);
    expect(accounting.ensureDefaults).toHaveBeenCalledWith('company-1');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'sales_order.fulfilled' }));
  });

  it('rejects fulfilment without a warehouse before stock is changed', async () => {
    await expect(service.updateStatus(user, 'order-1', 'fulfilled')).rejects.toThrow(BadRequestException);
    const calls = client.query.mock.calls as unknown as [string, unknown[]?][];
    expect(calls.some(([sql]) => sql.includes('UPDATE inventory_stock_levels'))).toBe(false);
    expect(calls.some(([sql]) => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects insufficient available stock without recording a movement or completing the order', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM sales_orders WHERE id = $1') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'order-1', status: 'processing', order_number: 'SO-2026-00001' }], rowCount: 1 };
      if (sql.includes('FROM warehouses WHERE id = $1')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
      if (sql.includes('FROM sales_order_items soi')) return { rows: [{ product_id: 'product-1', quantity: '2', is_service: false, is_active: true, cost_price: '4.5', product_name: 'Widget' }], rowCount: 1 };
      if (sql.includes('FROM inventory_stock_levels')) return { rows: [{ quantity: '2', reserved_quantity: '1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(service.updateStatus(user, 'order-1', 'fulfilled', 'warehouse-1')).rejects.toThrow(BadRequestException);
    const calls = client.query.mock.calls as unknown as [string, unknown[]?][];
    expect(calls.some(([sql]) => sql.includes('UPDATE inventory_stock_levels'))).toBe(false);
    expect(calls.some(([sql]) => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(calls.some(([sql]) => sql.includes('UPDATE sales_orders SET status'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
