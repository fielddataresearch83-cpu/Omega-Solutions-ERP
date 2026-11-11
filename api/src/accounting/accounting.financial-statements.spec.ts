import { describe, expect, it, vi } from 'vitest';
import { AccountingService } from './accounting.service.js';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

const user: AuthenticatedUser = {
  userId: 'user-1', email: 'owner@example.test', fullName: 'Test Owner',
  companyId: 'company-active', branchId: null, role: 'owner', permissions: ['accounting:read'],
};

function makeService(
  accountRows: Record<string, unknown>[],
  options?: { branchId?: string | null; companyId?: string },
) {
  const companyId = options?.companyId ?? 'company-active';
  const branchId = options?.branchId ?? null;
  const db = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('SELECT currency FROM companies')) return { rows: [{ currency: 'KES' }], rowCount: 1 };
      if (sql.includes('chart_of_accounts')) return { rows: accountRows, rowCount: accountRows.length };
      return { rows: [], rowCount: 0 };
    }),
    transaction: vi.fn(),
  };
  const memberships = {
    getMembership: vi.fn().mockResolvedValue({ companyId, branchId, role: 'owner' }),
    getMembershipForCompany: vi.fn().mockResolvedValue({ companyId, branchId, role: 'owner' }),
  };
  const service = new AccountingService(
    db as unknown as DatabaseService,
    memberships as unknown as MembershipsService,
    { log: vi.fn() } as unknown as AuditService,
  );
  return { service, db, memberships };
}

describe('AccountingService.profitAndLoss', () => {
  it('separates income, cost of sales, operating expenses and computes net profit', async () => {
    const { service, db } = makeService([
      { id: 'r', code: '4000', name: 'Sales Revenue', account_type: 'income', system_code: 'sales_revenue', balance: '10000' },
      { id: 'p', code: '5000', name: 'Purchases', account_type: 'expense', system_code: 'purchases_expense', balance: '4000' },
      { id: 'o', code: '5100', name: 'Operating Expenses', account_type: 'expense', system_code: 'operating_expense', balance: '2000' },
    ]);

    const result = await service.profitAndLoss(user, '2026-01-01', '2026-12-31');

    expect(result.currency).toBe('KES');
    expect(result.totalIncome).toBe(10000);
    expect(result.costOfSales).toBe(4000);
    expect(result.grossProfit).toBe(6000);
    expect(result.operatingExpenses).toBe(2000);
    expect(result.totalExpenses).toBe(6000);
    expect(result.netProfit).toBe(4000);
    expect(result.incomeAccounts).toHaveLength(1);
    expect(result.expenseAccounts).toHaveLength(2);
    const sql = String(db.query.mock.calls.find(([s]) => String(s).includes('chart_of_accounts'))?.[0]);
    expect(sql).toContain("j.status='posted'");
    expect(sql).toContain("j.entry_date>=$2::date");
    expect(sql).toContain("j.entry_date<=$3::date");
  });

  it('excludes draft and reversed entries via the posted status filter', async () => {
    const { service, db } = makeService([]);
    await service.profitAndLoss(user, '2026-01-01', '2026-12-31');
    const sql = String(db.query.mock.calls.find(([s]) => String(s).includes('chart_of_accounts'))?.[0]);
    expect(sql).toContain("j.status='posted'");
  });

  it('rejects invalid date formats', async () => {
    const { service, db } = makeService([]);
    await expect(service.profitAndLoss(user, '2026-02-30', '2026-12-31')).rejects.toThrow('startDate must be a valid YYYY-MM-DD date.');
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('chart_of_accounts'), expect.anything());
  });

  it('rejects startDate after endDate', async () => {
    const { service, db } = makeService([]);
    await expect(service.profitAndLoss(user, '2026-12-31', '2026-01-01')).rejects.toThrow('startDate must be on or before endDate.');
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('chart_of_accounts'), expect.anything());
  });

  it('returns empty data when no accounts exist', async () => {
    const { service } = makeService([]);
    const result = await service.profitAndLoss(user, '2026-01-01', '2026-12-31');
    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.netProfit).toBe(0);
    expect(result.incomeAccounts).toHaveLength(0);
  });

  it('blocks branch-bound users from accessing P&L', async () => {
    const { service } = makeService([], { branchId: 'branch-a' });
    const branchUser = { ...user, branchId: 'branch-a' };
    await expect(service.profitAndLoss(branchUser, '2026-01-01', '2026-12-31')).rejects.toThrow('company-wide');
  });

  it('scopes all queries to the authenticated company id', async () => {
    const { service, db } = makeService([]);
    await service.profitAndLoss(user, '2026-01-01', '2026-12-31');
    const accountCall = db.query.mock.calls.find(([s]) => String(s).includes('chart_of_accounts'));
    expect(accountCall?.[1]?.[0]).toBe('company-active');
  });
});

describe('AccountingService.balanceSheet', () => {
  it('computes assets, liabilities, equity and the balance equation', async () => {
    const { service } = makeService([
      { id: 'cash', code: '1000', name: 'Cash', account_type: 'asset', system_code: 'cash', balance: '5000' },
      { id: 'ar', code: '1100', name: 'AR', account_type: 'asset', system_code: 'accounts_receivable', balance: '3000' },
      { id: 'ap', code: '2000', name: 'AP', account_type: 'liability', system_code: 'accounts_payable', balance: '2000' },
      { id: 'eq', code: '3000', name: 'Equity', account_type: 'equity', system_code: 'equity', balance: '6000' },
    ]);

    const result = await service.balanceSheet(user, '2026-12-31');

    expect(result.totalAssets).toBe(8000);
    expect(result.totalLiabilities).toBe(2000);
    expect(result.totalEquity).toBe(6000);
    expect(result.totalLiabilitiesAndEquity).toBe(8000);
    expect(result.balanced).toBe(true);
    expect(result.variance).toBe(0);
    expect(result.assetAccounts).toHaveLength(2);
    expect(result.liabilityAccounts).toHaveLength(1);
    expect(result.equityAccounts).toHaveLength(1);
  });

  it('reports out-of-balance variance without forcing it to zero', async () => {
    const { service } = makeService([
      { id: 'cash', code: '1000', name: 'Cash', account_type: 'asset', system_code: 'cash', balance: '5000' },
      { id: 'eq', code: '3000', name: 'Equity', account_type: 'equity', system_code: 'equity', balance: '3000' },
    ]);

    const result = await service.balanceSheet(user, '2026-12-31');
    expect(result.totalAssets).toBe(5000);
    expect(result.totalLiabilitiesAndEquity).toBe(3000);
    expect(result.variance).toBe(2000);
    expect(result.balanced).toBe(false);
  });

  it('uses cumulative balances up to the as-of date', async () => {
    const { service, db } = makeService([]);
    await service.balanceSheet(user, '2026-06-30');
    const sql = String(db.query.mock.calls.find(([s]) => String(s).includes('chart_of_accounts'))?.[0]);
    expect(sql).toContain("j.entry_date<=$2::date");
    expect(sql).toContain("j.status='posted'");
  });

  it('rejects invalid as-of dates', async () => {
    const { service, db } = makeService([]);
    await expect(service.balanceSheet(user, 'not-a-date')).rejects.toThrow('asOfDate must be a valid YYYY-MM-DD date.');
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('chart_of_accounts'), expect.anything());
  });

  it('blocks branch-bound users', async () => {
    const { service } = makeService([], { branchId: 'branch-a' });
    const branchUser = { ...user, branchId: 'branch-a' };
    await expect(service.balanceSheet(branchUser, '2026-12-31')).rejects.toThrow('company-wide');
  });

  it('returns empty balances when no accounts exist', async () => {
    const { service } = makeService([]);
    const result = await service.balanceSheet(user, '2026-12-31');
    expect(result.totalAssets).toBe(0);
    expect(result.totalLiabilities).toBe(0);
    expect(result.totalEquity).toBe(0);
    expect(result.balanced).toBe(true);
  });
});

describe('AccountingService.cashFlow', () => {
  it('computes opening, closing, and net movement for cash/bank/mpesa accounts', async () => {
    const { service } = makeService([
      { account_code: '1000', account_name: 'Cash on Hand', opening_balance: '2000', closing_balance: '5000', net_movement: '3000' },
      { account_code: '1010', account_name: 'Bank Account', opening_balance: '10000', closing_balance: '8000', net_movement: '-2000' },
    ]);

    const result = await service.cashFlow(user, '2026-01-01', '2026-12-31');

    expect(result.method).toBe('direct');
    expect(result.cashAccounts).toHaveLength(2);
    expect(result.totalOpeningBalance).toBe(12000);
    expect(result.totalClosingBalance).toBe(13000);
    expect(result.netCashMovement).toBe(1000);
    expect(result.limitation).toBeTruthy();
  });

  it('rejects invalid date formats', async () => {
    const { service, db } = makeService([]);
    await expect(service.cashFlow(user, '2026-13-01', '2026-12-31')).rejects.toThrow('startDate must be a valid YYYY-MM-DD date.');
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('chart_of_accounts'), expect.anything());
  });

  it('rejects startDate after endDate', async () => {
    const { service } = makeService([]);
    await expect(service.cashFlow(user, '2026-12-31', '2026-01-01')).rejects.toThrow('startDate must be on or before endDate.');
  });

  it('blocks branch-bound users', async () => {
    const { service } = makeService([], { branchId: 'branch-a' });
    const branchUser = { ...user, branchId: 'branch-a' };
    await expect(service.cashFlow(branchUser, '2026-01-01', '2026-12-31')).rejects.toThrow('company-wide');
  });

  it('returns empty cash accounts when none exist', async () => {
    const { service } = makeService([]);
    const result = await service.cashFlow(user, '2026-01-01', '2026-12-31');
    expect(result.cashAccounts).toHaveLength(0);
    expect(result.netCashMovement).toBe(0);
    expect(result.totalOpeningBalance).toBe(0);
    expect(result.totalClosingBalance).toBe(0);
  });
});
