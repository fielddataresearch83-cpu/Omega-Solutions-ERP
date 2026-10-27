import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service.js';

describe('PurchaseOrdersService configured tax policy', () => {
  const user = { userId: 'user-1', companyId: 'company-1', branchId: null } as any;

  function setup(productRate: number) {
    const calls: Array<{sql:string;params?:unknown[]}> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({sql,params});
        if (sql.includes("FROM suppliers")) return { rows: [{ id: 'supplier-1' }], rowCount: 1 };
        if (sql.includes('purchase_order_sequences')) return { rows: [{ next_number: 1 }], rowCount: 1 };
        if (sql.includes('SELECT settings FROM companies')) return {
          rows: [{ settings: { taxPolicy: { mode: 'configured', vatRegistered: true, standardRate: 16 } } }], rowCount: 1,
        };
        if (sql.includes('FROM products WHERE id=$1')) return {
          rows: [{ id: 'product-1', name: 'Cleaning liquid', sku: 'CL-1', is_service: false, is_active: true, tax_treatment: 'standard', tax_rate: productRate }],
          rowCount: 1,
        };
        if (sql.includes('INSERT INTO purchase_orders')) return { rows: [{ id: 'po-1' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    };
    const db = {
      transaction: vi.fn((callback: (tx: typeof client) => Promise<unknown>) => callback(client)),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT po.*,s.name AS supplier_name')) return { rows: [{ id: 'po-1', company_id: 'company-1' }], rowCount: 1 };
        if (sql.includes('SELECT * FROM purchase_order_items')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }),
    };
    const memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }) };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const accounting = { ensureDefaults: vi.fn().mockResolvedValue(undefined) };
    return { service: new PurchaseOrdersService(db as any, memberships as any, audit as any, accounting as any), calls, client };
  }

  it('uses the configured product rate rather than a client-supplied purchase tax rate', async () => {
    const { service, calls } = setup(16);
    await service.create(user, {
      supplierId: 'supplier-1',
      items: [{ productId: 'product-1', quantity: 2, unitCost: 100, taxRate: 0 }],
    } as any);
    const itemInsert = calls.find(call => call.sql.includes('INSERT INTO purchase_order_items'));
    expect(itemInsert?.params?.[7]).toBe(16);
    expect(itemInsert?.params?.[9]).toBe(32);
    expect(itemInsert?.params?.[10]).toBe(232);
  });

  it('rejects a standard-rated purchase when the product rate conflicts with company policy', async () => {
    const { service, calls } = setup(8);
    await expect(service.create(user, {
      supplierId: 'supplier-1',
      items: [{ productId: 'product-1', quantity: 2, unitCost: 100, taxRate: 16 }],
    } as any)).rejects.toThrow(BadRequestException);
    expect(calls.some(call => call.sql.includes('INSERT INTO purchase_orders'))).toBe(false);
    expect(calls.some(call => call.sql.includes('INSERT INTO purchase_order_items'))).toBe(false);
  });
});
