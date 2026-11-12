import { AccountingService } from './accounting.service.js';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

describe('AccountingService receivables reconciliation', () => {
  const user: AuthenticatedUser = {
    userId: 'user-1', email: 'owner@example.test', fullName: 'Test Owner',
    companyId: 'company-active', branchId: null, role: 'owner', permissions: ['accounting:read'],
  };
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let memberships: { getMembership: ReturnType<typeof vi.fn>; getMembershipForCompany: ReturnType<typeof vi.fn> };
  let service: AccountingService;

  beforeEach(() => {
    const client = { query: vi.fn((sql: string, params?: unknown[]) => (sql.startsWith('SET TRANSACTION') || sql.startsWith('INSERT INTO chart_of_accounts')) ? Promise.resolve({ rows: [], rowCount: 1 }) : db.query(sql, params)) };
    db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ balance: '100.00' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ balance: '80.00' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ current: '30.00', days_1_to_30: '20.00', days_31_to_60: '20.00', days_61_plus: '10.00' }], rowCount: 1 }),
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(client)),
    };
    const membership = { companyId: 'company-active', branchId: null, role: 'owner' };
    memberships = {
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-default', branchId: null, role: 'owner' }),
      getMembershipForCompany: vi.fn().mockResolvedValue(membership),
    };
    service = new AccountingService(
      db as unknown as DatabaseService,
      memberships as unknown as MembershipsService,
      { log: vi.fn() } as unknown as AuditService,
    );
  });

  it('compares the active company AR control balance with open invoices and reports ageing', async () => {
    const result = await service.receivablesReconciliation(user);

    expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-1', 'company-active');
    expect(memberships.getMembership).not.toHaveBeenCalled();
    expect(result.controlAccountBalance).toBe(100);
    expect(result.customerInvoicesBalance).toBe(80);
    expect(result.variance).toBe(20);
    expect(result.reconciled).toBe(false);
    expect(result.ageing).toEqual({ current: 30, days1to30: 20, days31to60: 20, days61plus: 10 });
    expect(db.query).toHaveBeenCalledTimes(3);
    expect(db.query.mock.calls[1][0]).toContain("i.status NOT IN ('draft','cancelled')");
    const calls = db.query.mock.calls as unknown as [string, unknown[]][];
    expect(calls.every((call) => call[1]?.[0] === 'company-active')).toBe(true);
  });

  it('marks the receivables ledger reconciled when the variance is within one cent', async () => {
    db.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ balance: '80.00' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ balance: '80.01' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ current: '80.01', days_1_to_30: '0', days_31_to_60: '0', days_61_plus: '0' }], rowCount: 1 });

    const result = await service.receivablesReconciliation(user);

    expect(result.variance).toBe(-0.01);
    expect(result.reconciled).toBe(true);
  });
  it('seeds the work-in-progress control account for manufacturing', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) =>
      callback({ query: clientQuery }),
    );

    await service.ensureDefaults('company-active');

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO chart_of_accounts'),
      ['company-active', '1250', 'Work in Progress', 'asset', 'debit', 'work_in_progress', 'operating'],
    );
  });

});


describe('AccountingService payables reconciliation', () => {
  const user: AuthenticatedUser = {
    userId: 'user-1', email: 'owner@example.test', fullName: 'Test Owner',
    companyId: 'company-active', branchId: null, role: 'owner', permissions: ['accounting:read'],
  };
  let db: { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let memberships: { getMembership: ReturnType<typeof vi.fn>; getMembershipForCompany: ReturnType<typeof vi.fn> };
  let service: AccountingService;

  beforeEach(() => {
    db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("a.system_code='accounts_payable'")) return { rows: [{ balance: '232.00' }], rowCount: 1 };
        if (sql.includes('SUM(b.total-b.paid_amount)')) return { rows: [{ balance: '232.00' }], rowCount: 1 };
        return { rows: [{ current: '132.00', days_1_to_30: '100.00', days_31_to_60: '0.00', days_61_plus: '0.00' }], rowCount: 1 };
      }),
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) =>
        callback({ query: vi.fn((sql: string, params?: unknown[]) => sql.startsWith('SET TRANSACTION') ? Promise.resolve({ rows: [], rowCount: 1 }) : db.query(sql, params)) }),
      ),
    };
    memberships = {
      getMembership: vi.fn().mockResolvedValue({ companyId: 'company-default', branchId: null, role: 'owner' }),
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-active', branchId: null, role: 'owner' }),
    };
    service = new AccountingService(
      db as unknown as DatabaseService,
      memberships as unknown as MembershipsService,
      { log: vi.fn() } as unknown as AuditService,
    );
  });

  it('reconciles the AP control account to outstanding supplier bills and returns ageing', async () => {
    const result = await service.payablesReconciliation(user);

    expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-1', 'company-active');
    expect(memberships.getMembership).not.toHaveBeenCalled();
    expect(result.controlAccountBalance).toBe(232);
    expect(result.supplierBillsBalance).toBe(232);
    expect(result.variance).toBe(0);
    expect(result.reconciled).toBe(true);
    expect(result.ageing).toEqual({ current: 132, days1to30: 100, days31to60: 0, days61plus: 0 });
    expect(db.query).toHaveBeenCalledTimes(3);
    const calls = db.query.mock.calls as unknown as [string, unknown[]][];
    expect(calls.every((call) => call[1]?.[0] === 'company-active')).toBe(true);
    expect(calls[1][0]).toContain("b.status<>'void'");
    expect(calls[0][0]).toContain("j.status='posted'");
    expect(calls[0][0]).toContain("a.system_code='accounts_payable'");
    expect(calls[2][0]).toContain("b.status<>'void'");
  });

  it('flags a supplier subledger variance greater than one cent', async () => {
    db.query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes("a.system_code='accounts_payable'")) return { rows: [{ balance: '232.00' }], rowCount: 1 };
      if (sql.includes('SUM(b.total-b.paid_amount)')) return { rows: [{ balance: '231.98' }], rowCount: 1 };
      return { rows: [{ current: '231.98', days_1_to_30: '0', days_31_to_60: '0', days_61_plus: '0' }], rowCount: 1 };
    });

    const result = await service.payablesReconciliation(user);

    expect(result.variance).toBe(0.02);
    expect(result.reconciled).toBe(false);
  });
});


describe('AccountingService trial balance',()=>{
 const user:AuthenticatedUser={userId:'user-1',email:'owner@example.test',fullName:'Owner',companyId:'company-active',branchId:null,role:'owner',permissions:['accounting:read']};
 let db:{query:ReturnType<typeof vi.fn>;transaction:ReturnType<typeof vi.fn>};
 let memberships:{getMembership:ReturnType<typeof vi.fn>;getMembershipForCompany:ReturnType<typeof vi.fn>};
 let service:AccountingService;
 beforeEach(()=>{
  db={query:vi.fn().mockResolvedValue({rows:[
   {id:'cash',code:'1000',name:'Cash',account_type:'asset',normal_side:'debit',total_debits:'100',total_credits:'20',debit_balance:'80',credit_balance:'0'},
   {id:'sales',code:'4000',name:'Sales',account_type:'income',normal_side:'credit',total_debits:'0',total_credits:'80',debit_balance:'0',credit_balance:'80'},
  ],rowCount:2}),transaction:vi.fn()};
  memberships={getMembership:vi.fn(),getMembershipForCompany:vi.fn().mockResolvedValue({companyId:'company-active',branchId:null,role:'owner'})};
  service=new AccountingService(db as unknown as DatabaseService,memberships as unknown as MembershipsService,{log:vi.fn()} as unknown as AuditService);
 });
 it('returns a balanced cumulative trial balance for the active company as of a date',async()=>{
  const result=await service.trialBalance(user,'2026-10-15');
  expect(result.balanced).toBe(true);
  expect(result.totalDebits).toBe(80);
  expect(result.totalCredits).toBe(80);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining("j.status='posted'"),['company-active','2026-10-15']);
  expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-1','company-active');
 });
 it('rejects invalid date ranges before querying the ledger',async()=>{
  await expect(service.trialBalance(user,'2026-02-30')).rejects.toThrow('asOfDate must be a valid YYYY-MM-DD date.');
  expect(db.query).not.toHaveBeenCalled();
 });
 it('blocks branch-bound users from company-wide accounting reports',async()=>{
  memberships.getMembershipForCompany.mockResolvedValue({companyId:'company-active',branchId:'branch-a',role:'staff'});
  const branchUser={...user,branchId:'branch-a',role:'staff' as const};
  await expect(service.trialBalance(branchUser,'2026-10-15')).rejects.toThrow('Accounting ledgers and reconciliations are company-wide');
  expect(db.query).not.toHaveBeenCalled();
 });

});
