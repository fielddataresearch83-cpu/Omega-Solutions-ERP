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


describe('SupplierBillsService supplier balance synchronization', () => {
  it('recomputes the supplier balance from non-void bill balances in the same transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const db = { query: vi.fn(), transaction: vi.fn() };
    const memberships = { getMembership: vi.fn(), getMembershipForCompany: vi.fn() };
    const audit = { log: vi.fn(), logInTransaction: vi.fn() };
    const accounting = { ensureDefaults: vi.fn() };
    const service = new SupplierBillsService(db as any, memberships as any, audit as any, accounting as any);
    const internal = service as unknown as {
      refreshSupplierBalance: (tx: typeof client, companyId: string, supplierId: string) => Promise<void>;
    };

    await internal.refreshSupplierBalance(client, 'company-1', 'supplier-1');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("b.status<>'void'"),
      ['company-1', 'supplier-1'],
    );
    expect(client.query.mock.calls[0][0]).toContain('SUM(GREATEST(0, b.total - b.paid_amount))');
    expect(db.transaction).not.toHaveBeenCalled();
  });
});


describe('SupplierBillsService withholding tax settlement', () => {
  it('splits gross bill settlement into net cash and withholding payable journals', async () => {
    const user = { userId: 'user-1', companyId: 'company-1' } as any;
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT total,paid_amount,status FROM supplier_bills')) {
          return { rows: [{ total: '100.00', paid_amount: '0.00', status: 'open' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO supplier_bill_payments')) return { rows: [{ id: 'payment-1' }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entry_sequences')) return { rows: [{ next_number: 1 }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entries')) return { rows: [{ id: 'journal-1' }], rowCount: 1 };
        if (sql.includes('SELECT id FROM chart_of_accounts')) {
          const code = params?.[1];
          return { rows: [{ id: 'account-' + String(code) }], rowCount: 1 };
        }
        if (sql.includes('SELECT supplier_id FROM supplier_bills')) return { rows: [{ supplier_id: 'supplier-1' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    };
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'bill-1', bill_number: 'BILL-1', total: '100', paid_amount: '100', balance: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ amount: '100', cash_amount: '80', withholding_tax_amount: '20' }], rowCount: 1 }),
      transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client)),
    };
    const memberships = {
      getMembership: vi.fn(),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const audit = { log: vi.fn(), logInTransaction: vi.fn().mockResolvedValue(undefined) };
    const accounting = { ensureDefaults: vi.fn().mockResolvedValue(undefined) };
    const service = new SupplierBillsService(db as any, memberships as any, audit as any, accounting as any);

    await service.recordPayment(user, 'bill-1', {
      amount: 100, method: 'bank_transfer', withholdingTaxAmount: 20,
      withholdingCertificateNumber: 'WHT-CERT-2026-001',
    } as any);

    expect(accounting.ensureDefaults).toHaveBeenCalledWith('company-1', client);
    const paymentInsert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO supplier_bill_payments'));
    expect(paymentInsert?.[1]).toEqual([
      'company-1', 'bill-1', 100, 80, 20, 'WHT-CERT-2026-001', null,
      'bank_transfer', null, null, 'user-1',
    ]);
    const journalLines = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO journal_entry_lines'));
    expect(journalLines.map(([, params]) => params)).toEqual([
      ['company-1', 'journal-1', 'account-accounts_payable', 'Reduce supplier payable', 100, 0],
      ['company-1', 'journal-1', 'account-bank', 'Net payment by bank_transfer', 0, 80],
      ['company-1', 'journal-1', 'account-withholding_tax_payable', 'Withholding tax payable to KRA', 0, 20],
    ]);
  });

  it('requires a certificate reference when withholding tax is recorded', async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ total: '100', paid_amount: '0', status: 'open' }], rowCount: 1 }),
    };
    const db = { query: vi.fn(), transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client)) };
    const memberships = { getMembership: vi.fn(), getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }) };
    const accounting = { ensureDefaults: vi.fn() };
    const service = new SupplierBillsService(db as any, memberships as any, { logInTransaction: vi.fn() } as any, accounting as any);

    await expect(service.recordPayment({ userId: 'user-1', companyId: 'company-1' } as any, 'bill-1', {
      amount: 100, method: 'bank_transfer', withholdingTaxAmount: 20,
    } as any)).rejects.toThrow('withholding tax certificate/reference is required');

    expect(accounting.ensureDefaults).not.toHaveBeenCalled();
  });
});
