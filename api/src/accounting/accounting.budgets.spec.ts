import { BadRequestException, ConflictException } from '@nestjs/common';
import { AccountingService } from './accounting.service.js';

function setup() {
  const client = { query: vi.fn() };
  const db = {
    query: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client)),
  };
  const memberships = {
    getMembership: vi.fn(),
    getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined), logInTransaction: vi.fn().mockResolvedValue(undefined) };
  return { service: new AccountingService(db as any, memberships as any, audit as any), db, client, audit };
}

describe('AccountingService cost centres and budgets', () => {
  it('creates a normalized cost centre and audits the creation', async () => {
    const { service, client, audit } = setup();
    client.query.mockResolvedValueOnce({ rows: [{ id: 'centre-1', code: 'OPS', name: 'Operations' }], rowCount: 1 });

    const result = await service.createCostCentre(
      { userId: 'user-1', companyId: 'company-1' } as any,
      { code: ' ops ', name: ' Operations ', description: 'Main operations' } as any,
    );

    expect(result.id).toBe('centre-1');
    expect(client.query.mock.calls[0][1]).toEqual(['company-1', 'OPS', 'Operations', 'Main operations', 'user-1']);
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'accounting.cost_centre.create', entityId: 'centre-1' }));
  });

  it('creates a monthly budget only for active company accounts and cost centres', async () => {
    const { service, db, client, audit } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'expense-account', account_type: 'expense' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'centre-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'budget-1' }], rowCount: 1 });
    db.query.mockResolvedValueOnce({ rows: [{
      id: 'budget-1', budget_amount: '50000', actual_amount: '12000', favourable_variance: '38000',
    }], rowCount: 1 });

    const result = await service.createBudget(
      { userId: 'user-1', companyId: 'company-1' } as any,
      { fiscalYear: 2026, periodMonth: 11, accountId: 'expense-account', costCentreId: 'centre-1', budgetAmount: 50000 } as any,
    );

    expect(result.id).toBe('budget-1');
    expect(client.query.mock.calls[0][0]).toContain("account_type IN ('income','expense')");
    expect(client.query.mock.calls[1][0]).toContain('cost_centres');
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'accounting.budget.create', entityId: 'budget-1',
    }));
  });

  it('approves only draft budget lines and records the status transition', async () => {
    const { service, db, client, audit } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'budget-1', status: 'draft' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'budget-1', status: 'approved' }], rowCount: 1 });

    const result = await service.approveBudget({ userId: 'user-1', companyId: 'company-1' } as any, 'budget-1');

    expect(result.status).toBe('approved');
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'accounting.budget.approve', entityId: 'budget-1',
    }));
  });

  it('rejects re-approval of an already approved budget', async () => {
    const { service, db, client } = setup();
    client.query.mockResolvedValueOnce({ rows: [{ id: 'budget-1', status: 'approved' }], rowCount: 1 });
    await expect(service.approveBudget({ userId: 'user-1', companyId: 'company-1' } as any, 'budget-1'))
      .rejects.toThrow(ConflictException);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('calculates budget actuals only from posted journals in the selected month', async () => {
    const { service, db } = setup();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'budget-1', actual_amount: '12000', favourable_variance: '38000' }], rowCount: 1 });

    const result = await service.budgetVsActual({ userId: 'user-1', companyId: 'company-1' } as any, 2026, 11);

    expect(result[0].actual_amount).toBe('12000');
    expect(db.query.mock.calls[0][1]).toEqual(['company-1', 2026, 11]);
    expect(db.query.mock.calls[0][0]).toContain("j.status='posted'");
    expect(db.query.mock.calls[0][0]).toContain('(b.cost_centre_id IS NULL OR l.cost_centre_id=b.cost_centre_id)');
  });

  it('rejects a budget for an inactive or non-P&L account', async () => {
    const { service, client } = setup();
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.createBudget(
      { userId: 'user-1', companyId: 'company-1' } as any,
      { fiscalYear: 2026, periodMonth: 11, accountId: 'asset-account', budgetAmount: 1000 } as any,
    )).rejects.toThrow(BadRequestException);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
