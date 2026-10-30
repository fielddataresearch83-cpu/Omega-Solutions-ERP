import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { ProductImageStorageService } from '../products/product-image-storage.service.js';
import { PosService, buildCogsJournalLines } from './pos.service.js';

type Mock = ReturnType<typeof vi.fn>;

describe('PosService', () => {
  let service: PosService;
  let db: { query: Mock; transaction: Mock };
  let memberships: { getMembership: Mock; getMembershipForCompany: Mock };
  let audit: { log: Mock; logInTransaction: Mock };
  let accounting: { ensureDefaults: Mock };
  const user = { userId: 'cashier-1', companyId: 'company-1', permissions: ['sales:team-read'] } as any;

  beforeEach(async () => {
    db = { query: vi.fn(), transaction: vi.fn() };
    memberships = {
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'owner' }),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null, role: 'owner' }),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined), logInTransaction: vi.fn().mockResolvedValue(undefined) };
    accounting = { ensureDefaults: vi.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosService,
        { provide: DatabaseService, useValue: db },
        { provide: MembershipsService, useValue: memberships },
        { provide: AuditService, useValue: audit },
        { provide: AccountingService, useValue: accounting },
        { provide: ProductImageStorageService, useValue: { signedReadUrl: vi.fn((key: string) => 'signed:' + key) } },
      ],
    }).compile();
    service = module.get(PosService);
  });

  it('searches active products within the selected company and warehouse', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'product-1', sku: 'SKU-1' }], rowCount: 1 });
    const result = await service.searchProducts(user, 'tea', 'warehouse-1');
    expect(result).toHaveLength(1);
    expect(db.query.mock.calls[0][0]).toContain('p.company_id=$1');
    expect(db.query.mock.calls[0][0]).toContain('s.warehouse_id=$2::uuid');
    expect(db.query.mock.calls[0][1]).toEqual(['company-1', 'warehouse-1', '%tea%']);
  });

  it('forces a salesperson product search to their assigned warehouse', async () => {
    const salesperson = { ...user, permissions: [] };
    db.query
      .mockResolvedValueOnce({ rows: [{ warehouse_id: 'warehouse-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'product-1' }], rowCount: 1 });

    const result = await service.searchProducts(salesperson, 'tea', 'warehouse-2');

    expect(result).toHaveLength(1);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][1]).toEqual(['company-1', 'warehouse-2', '%tea%']);
  });

  it('rejects salesperson product searches for another warehouse', async () => {
    const salesperson = { ...user, permissions: [] };
    db.query.mockResolvedValueOnce({ rows: [{ warehouse_id: 'warehouse-2' }], rowCount: 1 });

    await expect(service.searchProducts(salesperson, 'tea', 'warehouse-1'))
      .rejects.toThrow('You can only sell from your assigned warehouse.');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('blocks salesperson product searches until a manager assigns stock', async () => {
    const salesperson = { ...user, permissions: [] };
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.searchProducts(salesperson, 'tea'))
      .rejects.toThrow('Your manager must assign a stock warehouse before selling.');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('limits POS history to the current salesperson unless team-read is granted', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await service.listSales({ ...user, permissions: ['sales:read'] }, '10');
    expect(db.query.mock.calls[0][0]).toContain('WHERE s.company_id=$1 AND ($5::uuid IS NULL OR r.branch_id=$5::uuid)');
    expect(db.query.mock.calls[0][0]).toContain('AND ($3::boolean=true OR s.created_by=$4)');
    expect(db.query.mock.calls[0][1]).toEqual(['company-1', 10, false, 'cashier-1', null]);

    db.query.mockClear();
    await service.listSales({ ...user, permissions: ['sales:read', 'sales:team-read'] }, '10');
    expect(db.query.mock.calls[0][1]).toEqual(['company-1', 10, true, 'cashier-1', null]);
  });

  it('keeps the current shift lookup company- and cashier-scoped', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await service.currentShift(user)).toBeNull();
    expect(db.query.mock.calls[0][0]).toContain('s.company_id=$1');
    expect(db.query.mock.calls[0][0]).toContain('s.opened_by=$2');
    expect(db.query.mock.calls[0][1]).toEqual(['company-1', 'cashier-1', null]);
    expect(db.query.mock.calls[0][0]).toContain('AND ($3::uuid IS NULL OR r.branch_id=$3::uuid)');
  });

  it('calculates cash-up only from confirmed cash payments linked to this exact shift', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT s.id,s.opened_by,s.opening_float,s.status,s.register_id,r.branch_id')) return { rows: [{ id: 'shift-1', opened_by: 'cashier-1', opening_float: '100.00', status: 'open', register_id: 'register-1' }], rowCount: 1 };
      if (sql.includes('SUM(amount)') && sql.includes('pos_shift_id=$2')) return { rows: [{ total: '25.50' }], rowCount: 1 };
      if (sql.includes('UPDATE pos_shifts SET status')) return { rows: [{ id: 'shift-1', status: 'closed', expected_cash: '125.50', counted_cash: '130.00', cash_difference: '4.50' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));
    const result = await service.closeShift(user, 'shift-1', { countedCash: 130 });
    expect(result.expected_cash).toBe('125.50');
    expect(result.cash_difference).toBe('4.50');
    const cashCall = client.query.mock.calls.find(([sql]) => String(sql).includes('pos_shift_id=$2'));
    expect(cashCall?.[1]).toEqual(['company-1', 'shift-1']);
    expect(String(cashCall?.[0])).toContain("status IN ('confirmed','reconciled')");
    expect(String(cashCall?.[0])).toContain("method='cash'");
    expect(audit.logInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'pos.shift.close', entityId: 'shift-1' }));
  });

  it('returns the original sale for a retry by the same cashier without creating another sale', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id,sale_number,total,subtotal,tax_amount,amount_confirmed,status,invoice_id,created_by FROM pos_sales')) {
        return { rows: [{ id: 'sale-1', sale_number: 'POS-2026-00001', total: '125.00', subtotal: '125.00', tax_amount: '0.00', amount_confirmed: '125.00', status: 'completed', invoice_id: 'invoice-1', created_by: 'cashier-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }) };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));
    const result = await service.checkout(user, {
      requestId: '11111111-1111-4111-8111-111111111111',
      shiftId: '22222222-2222-4222-8222-222222222222',
      warehouseId: '33333333-3333-4333-8333-333333333333',
      items: [{ productId: '44444444-4444-4444-8444-444444444444', quantity: 1 }],
      payments: [{ method: 'cash', amount: 125 }],
    } as any);
    expect(result).toMatchObject({ saleId: 'sale-1', saleNumber: 'POS-2026-00001', total: 125, idempotent: true });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(audit.log).not.toHaveBeenCalled();
  });


  it('posts balanced POS cost-of-goods journal lines against inventory', () => {
    const lines = buildCogsJournalLines(12345);
    expect(lines).toEqual([
      { systemCode: 'purchases_expense', debit: 123.45, credit: 0, description: 'Cost of goods sold' },
      { systemCode: 'inventory', debit: 0, credit: 123.45, description: 'Reduce inventory asset' },
    ]);
    expect(lines.reduce((sum, line) => sum + line.debit, 0)).toBe(lines.reduce((sum, line) => sum + line.credit, 0));
  });

  it('does not post a zero-value POS cost-of-goods journal', () => {
    expect(buildCogsJournalLines(0)).toEqual([]);
  });

  it('rejects invalid cost-of-goods cents before posting', () => {
    expect(() => buildCogsJournalLines(-1)).toThrow();
    expect(() => buildCogsJournalLines(12.5)).toThrow();
  });

  it('blocks a branch-bound manager from opening a register in another branch', async () => {
    memberships.getMembershipForCompany.mockResolvedValue({
      companyId: 'company-1', branchId: 'branch-1', role: 'manager',
    });
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'register-2', branch_id: 'branch-2' }],
        rowCount: 1,
      }),
    };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.openShift(user, { registerId: 'register-2', openingFloat: 0 }))
      .rejects.toThrow(ForbiddenException);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('blocks a branch-bound cashier from closing a shift in another branch', async () => {
    memberships.getMembershipForCompany.mockResolvedValue({
      companyId: 'company-1', branchId: 'branch-1', role: 'staff',
    });
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          id: 'shift-1', opened_by: 'cashier-1', opening_float: '0',
          status: 'open', register_id: 'register-2', branch_id: 'branch-2',
        }],
        rowCount: 1,
      }),
    };
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));

    await expect(service.closeShift(user, 'shift-1', { countedCash: 0 }))
      .rejects.toThrow(ForbiddenException);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects a negative opening float before any database write', async () => {
    await expect(service.openShift(user, { registerId: 'register-1', openingFloat: -1 })).rejects.toThrow();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
