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
  const audit = { log: vi.fn(), logInTransaction: vi.fn().mockResolvedValue(undefined) };
  return { service: new AccountingService(db as any, memberships as any, audit as any), db, client, audit };
}

describe('AccountingService bank statement imports', () => {
  it('imports statement lines against a company bank account and records an audit event', async () => {
    const { service, db, client, audit } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'bank-account', system_code: 'bank' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'import-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    db.query
      .mockResolvedValueOnce({ rows: [{
        id: 'import-1', opening_balance: '1000', closing_balance: '1250', bank_account_id: 'bank-account',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        id: 'line-1', debit: '0', credit: '250', status: 'unmatched', transaction_date: '2026-11-10',
      }], rowCount: 1 });

    const result = await service.importBankStatement({ userId: 'user-1', companyId: 'company-1' } as any, {
      accountId: 'bank-account', statementStart: '2026-11-01', statementEnd: '2026-11-30',
      openingBalance: 1000, closingBalance: 1250, fileName: 'bank-nov.csv',
      lines: [{ transactionDate: '2026-11-10', description: 'Customer deposit', credit: 250 }],
    } as any);

    expect(result.id).toBe('import-1');
    expect(result.lineCount).toBe(1);
    expect(result.calculatedClosingBalance).toBe(1250);
    expect(result.closingVariance).toBe(0);
    expect(client.query.mock.calls[0][0]).toContain("system_code IN ('bank','mpesa')");
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'accounting.bank_statement.import', entityId: 'import-1',
    }));
  });

  it('rejects statement lines outside the declared period before database writes', async () => {
    const { service, db } = setup();
    await expect(service.importBankStatement({ userId: 'user-1', companyId: 'company-1' } as any, {
      accountId: 'bank-account', statementStart: '2026-11-01', statementEnd: '2026-11-30',
      openingBalance: 1000, closingBalance: 1250,
      lines: [{ transactionDate: '2026-10-31', description: 'Out of period', credit: 250 }],
    } as any)).rejects.toThrow(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('matches only posted journal movements on the same bank account and amount', async () => {
    const { service, db, client, audit } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{
        id: 'line-1', bank_account_id: 'bank-account', transaction_date: '2026-11-10',
        debit: '0', credit: '250', status: 'unmatched',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'journal-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'journal-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'import-1', opening_balance: '1000', closing_balance: '1250' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'line-1', status: 'matched', debit: '0', credit: '250' }], rowCount: 1 });

    const result = await service.matchBankStatementLine(
      { userId: 'user-1', companyId: 'company-1' } as any, 'import-1', 'line-1', 'journal-1',
    );

    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);
    expect(client.query.mock.calls[1][0]).toContain('FOR SHARE');
    expect(client.query.mock.calls[2][0]).toContain('SUM(l.debit-l.credit)');
    expect(client.query.mock.calls[3][0]).toContain("status='matched'");
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'accounting.bank_statement.match', entityId: 'line-1',
    }));
  });

  it('prevents matching a statement line twice', async () => {
    const { service, db, client } = setup();
    client.query.mockResolvedValueOnce({ rows: [{
      id: 'line-1', bank_account_id: 'bank-account', transaction_date: '2026-11-10',
      debit: '0', credit: '250', status: 'matched',
    }], rowCount: 1 });
    await expect(service.matchBankStatementLine(
      { userId: 'user-1', companyId: 'company-1' } as any, 'import-1', 'line-1', 'journal-1',
    )).rejects.toThrow(ConflictException);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
});
