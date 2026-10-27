import { PurchaseOrdersService } from './purchase-orders.service.js';

describe('PurchaseOrdersService receipt atomicity', () => {
  const user = { userId: 'user-1', companyId: 'company-1', branchId: null } as any;

  it('keeps stock, receipt and journal writes inside one transaction and rejects the whole receipt if journal posting fails', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id,order_number,status FROM purchase_orders')) {
          return { rows: [{ id: 'po-1', order_number: 'PO-2026-00001', status: 'ordered' }], rowCount: 1 };
        }
        if (sql.includes('SELECT id FROM warehouses')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
        if (sql.includes('SELECT id,product_id,quantity,received_quantity,unit_cost,product_name FROM purchase_order_items')) {
          return { rows: [{ id: 'line-1', product_id: 'product-1', quantity: 5, received_quantity: 0, unit_cost: 10, product_name: 'Widget' }], rowCount: 1 };
        }
        if (sql.includes('SELECT id,is_active,is_service FROM products')) {
          return { rows: [{ id: 'product-1', is_active: true, is_service: false }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO journal_entry_sequences')) return { rows: [{ next_number: 1 }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entries')) return { rows: [{ id: 'journal-1' }], rowCount: 1 };
        if (sql.includes('FROM chart_of_accounts')) {
          return { rows: [{ id: 'account-inventory', system_code: 'inventory' }, { id: 'account-grni', system_code: 'goods_received_not_invoiced' }], rowCount: 2 };
        }
        if (sql.includes('INSERT INTO journal_entry_lines')) throw new Error('journal line insert failed');
        return { rows: [], rowCount: 1 };
      }),
    };
    const db = {
      transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client)),
      query: vi.fn(),
    };
    const memberships = {
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const accounting = { ensureDefaults: vi.fn().mockResolvedValue(undefined) };
    const service = new PurchaseOrdersService(db as any, memberships as any, audit as any, accounting as any);

    await expect(service.receive(user, 'po-1', {
      warehouseId: 'warehouse-1',
      items: [{ itemId: 'line-1', quantity: 2 }],
    } as any)).rejects.toThrow('journal line insert failed');

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(accounting.ensureDefaults).toHaveBeenCalledWith('company-1', client);
    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements.some(sql => sql.includes('INSERT INTO inventory_stock_levels'))).toBe(true);
    expect(statements.some(sql => sql.includes('INSERT INTO goods_receipts'))).toBe(true);
    expect(statements.some(sql => sql.includes('UPDATE purchase_orders SET status'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects a product that has become a service before writing receipt or stock records', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id,order_number,status FROM purchase_orders')) {
          return { rows: [{ id: 'po-1', order_number: 'PO-2026-00001', status: 'ordered' }], rowCount: 1 };
        }
        if (sql.includes('SELECT id FROM warehouses')) return { rows: [{ id: 'warehouse-1' }], rowCount: 1 };
        if (sql.includes('SELECT id,product_id,quantity,received_quantity,unit_cost,product_name FROM purchase_order_items')) {
          return { rows: [{ id: 'line-1', product_id: 'product-1', quantity: 5, received_quantity: 0, unit_cost: 10, product_name: 'Widget' }], rowCount: 1 };
        }
        if (sql.includes('SELECT id,is_active,is_service FROM products')) {
          return { rows: [{ id: 'product-1', is_active: true, is_service: true }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const db = {
      transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client)),
      query: vi.fn(),
    };
    const memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }) };
    const audit = { log: vi.fn() };
    const accounting = { ensureDefaults: vi.fn() };
    const service = new PurchaseOrdersService(db as any, memberships as any, audit as any, accounting as any);

    await expect(service.receive(user, 'po-1', {
      warehouseId: 'warehouse-1',
      items: [{ itemId: 'line-1', quantity: 2 }],
    } as any)).rejects.toThrow('Service items cannot be received into inventory.');

    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements.some(sql => sql.includes('INSERT INTO goods_receipts'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO inventory_stock_levels'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO inventory_stock_movements'))).toBe(false);
    expect(accounting.ensureDefaults).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects duplicate purchase-order line references before opening a transaction', async () => {
    const db = { transaction: vi.fn(), query: vi.fn() };
    const memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }) };
    const audit = { log: vi.fn() };
    const accounting = { ensureDefaults: vi.fn() };
    const service = new PurchaseOrdersService(db as any, memberships as any, audit as any, accounting as any);

    await expect(service.receive(user, 'po-1', {
      warehouseId: 'warehouse-1',
      items: [{ itemId: 'line-1', quantity: 1 }, { itemId: 'line-1', quantity: 1 }],
    } as any)).rejects.toThrow('Each purchase order line can only appear once per receipt.');
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
