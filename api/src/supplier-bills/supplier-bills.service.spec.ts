import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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

describe('SupplierBillsService date validation', () => {
  it('rejects a due date earlier than the bill date before accounting or database work', async () => {
    const db = { query: vi.fn(), transaction: vi.fn() };
    const memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const audit = { log: vi.fn() };
    const accounting = { ensureDefaults: vi.fn() };
    const service = new SupplierBillsService(db as any, memberships as any, audit as any, accounting as any);

    await expect(service.create({ userId: 'user-1', companyId: 'company-1' } as any, {
      supplierId: 'supplier-1',
      billDate: '2026-10-20',
      dueDate: '2026-10-19',
      items: [{ description: 'Cleaning materials', quantity: 1, unitCost: 100 }],
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(accounting.ensureDefaults).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('SupplierBillsService purchase-order line integrity', () => {
  it('rejects duplicate purchase-order line references before any bill or ledger writes', async () => {
    const db = { query: vi.fn(), transaction: vi.fn() };
    const memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const audit = { log: vi.fn() };
    const accounting = { ensureDefaults: vi.fn() };
    const service = new SupplierBillsService(db as any, memberships as any, audit as any, accounting as any);

    await expect(service.create({ userId: 'user-1', companyId: 'company-1' } as any, {
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      items: [
        { description: 'Cleaning materials', quantity: 4, unitCost: 100, purchaseOrderItemId: 'po-line-1' },
        { description: 'Cleaning materials split line', quantity: 4, unitCost: 100, purchaseOrderItemId: 'po-line-1' },
      ],
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(accounting.ensureDefaults).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('SupplierBillsService duplicate supplier invoice protection', () => {
  it('rejects a duplicate supplier invoice number before creating a second bill', async () => {
    const user = { userId: 'user-1', companyId: 'company-1' } as any;
    const client = {
      query: vi.fn(async (sql: string) => {
        const normalizedSql = sql.toLowerCase().replace(/\s+/g, ' ');
        const callIndex = client.query.mock.calls.length - 1;
        if (callIndex === 0) {
          expect(normalizedSql).toContain('from suppliers');
          return { rows: [{ id: 'supplier-1' }], rowCount: 1 };
        }
        if (callIndex === 1) {
          expect(normalizedSql).toContain('pg_advisory_xact_lock');
          return { rows: [], rowCount: 1 };
        }
        if (callIndex === 2) {
          expect(normalizedSql).toContain('from supplier_bills');
          expect(normalizedSql).toContain('supplier_invoice_number');
          return { rows: [{ id: 'existing-bill', bill_number: 'BILL-2026-00001' }], rowCount: 1 };
        }
        throw new Error('Unexpected query before duplicate is rejected: ' + sql);
      }),
    };
    const db = {
      query: vi.fn(),
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(client)),
    };
    const memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const audit = { log: vi.fn() };
    const accounting = { ensureDefaults: vi.fn() };
    const service = new SupplierBillsService(db as any, memberships as any, audit as any, accounting as any);

    await expect(service.create(user, {
      supplierId: 'supplier-1',
      supplierInvoiceNumber: '  INV-123  ',
      items: [{ description: 'Cleaning materials', quantity: 1, unitCost: 100 }],
    } as any)).rejects.toBeInstanceOf(ConflictException);

    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls[1]).toEqual([
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['supplier-bill-invoice:company-1:supplier-1:inv-123'],
    ]);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
