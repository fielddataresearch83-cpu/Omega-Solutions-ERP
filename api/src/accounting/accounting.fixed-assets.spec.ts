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
  const service = new AccountingService(db as any, memberships as any, audit as any);
  vi.spyOn(service, 'ensureDefaults').mockResolvedValue(undefined);
  return { service, db, client, audit };
}

describe('AccountingService fixed asset acquisition', () => {
  it('posts acquisition to fixed assets against the selected cash or bank account', async () => {
    const { service, db, client, audit } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [
        { id: 'asset-account', account_type: 'asset', normal_side: 'debit', system_code: 'fixed_assets' },
        { id: 'accum-account', account_type: 'asset', normal_side: 'credit', system_code: 'accumulated_depreciation' },
        { id: 'expense-account', account_type: 'expense', normal_side: 'debit', system_code: 'depreciation_expense' },
        { id: 'bank-account', account_type: 'asset', normal_side: 'debit', system_code: 'bank' },
      ], rowCount: 4 })
      .mockResolvedValueOnce({ rows: [{ id: 'asset-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ next_number: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'journal-1' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'asset-1', cost: '1200', net_book_value: '1200' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await service.createFixedAsset({ userId: 'user-1', companyId: 'company-1' } as any, {
      assetCode: 'LAPTOP-001', name: 'Finance laptop', acquisitionDate: '2026-11-12',
      cost: 1200, residualValue: 0, usefulLifeMonths: 12,
      assetAccountId: 'asset-account', accumulatedDepreciationAccountId: 'accum-account',
      depreciationExpenseAccountId: 'expense-account', paymentAccountId: 'bank-account',
    } as any);

    expect(result.id).toBe('asset-1');
    const journalLines = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO journal_entry_lines'));
    expect(journalLines[0][1]).toEqual([
      'company-1', 'journal-1', 'asset-account', 'Capitalise asset LAPTOP-001', 1200,
      'bank-account', 'Cash/bank payment for asset LAPTOP-001',
    ]);
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'accounting.fixed_asset.create', entityId: 'asset-1',
    }));
  });
});

describe('AccountingService fixed asset depreciation', () => {
  it('posts the first straight-line month and updates accumulated depreciation', async () => {
    const { service, db, client, audit } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{
        id: 'asset-1', asset_code: 'LAPTOP-001', name: 'Finance laptop',
        acquisition_date: '2026-11-12', cost: '1200', residual_value: '0',
        useful_life_months: 12, accumulated_depreciation: '0',
        asset_account_id: 'asset-account', accumulated_depreciation_account_id: 'accum-account',
        depreciation_expense_account_id: 'expense-account', status: 'active',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ period_end: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'accum-account' }, { id: 'expense-account' }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ next_number: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'journal-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'depreciation-1' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'asset-1', accumulated_depreciation: '100', net_book_value: '1100' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'depreciation-1', period_end: '2026-12-31', depreciation_amount: '100', entry_number: 'JE-2026-000001' }], rowCount: 1 });

    const result = await service.depreciateFixedAsset(
      { userId: 'user-1', companyId: 'company-1' } as any, 'asset-1', '2026-12-31',
    );

    expect(result.accumulated_depreciation).toBe('100');
    const depreciationInsert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO fixed_asset_depreciation'));
    expect(depreciationInsert?.[1]).toEqual(['company-1', 'asset-1', '2026-12-31', 100, 'journal-1', 'user-1']);
    const journalLines = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO journal_entry_lines'));
    expect(journalLines[0][1]).toEqual([
      'company-1', 'journal-1', 'expense-account', 'Depreciation expense - LAPTOP-001', 100,
      'accum-account', 'Accumulated depreciation - LAPTOP-001',
    ]);
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'accounting.fixed_asset.depreciate', entityId: 'asset-1',
    }));
  });

  it('requires depreciation periods to be posted in order', async () => {
    const { service, db, client } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{
        id: 'asset-1', asset_code: 'LAPTOP-001', name: 'Finance laptop',
        acquisition_date: '2026-11-12', cost: '1200', residual_value: '0',
        useful_life_months: 12, accumulated_depreciation: '0',
        asset_account_id: 'asset-account', accumulated_depreciation_account_id: 'accum-account',
        depreciation_expense_account_id: 'expense-account', status: 'active',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ period_end: null }], rowCount: 1 });

    await expect(service.depreciateFixedAsset(
      { userId: 'user-1', companyId: 'company-1' } as any, 'asset-1', '2027-01-31',
    )).rejects.toThrow(ConflictException);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('requires a month-end depreciation date', async () => {
    const { service, client } = setup();
    await expect(service.depreciateFixedAsset(
      { userId: 'user-1', companyId: 'company-1' } as any, 'asset-1', '2026-12-15',
    )).rejects.toThrow(BadRequestException);
    expect(client.query).not.toHaveBeenCalled();
  });
});


describe('AccountingService fixed asset disposal', () => {
  it('clears asset cost and accumulated depreciation and posts disposal gain', async () => {
    const { service, db, client, audit } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{
        id: 'asset-1', asset_code: 'LAPTOP-001', name: 'Finance laptop',
        acquisition_date: '2026-11-12', cost: '1200', accumulated_depreciation: '100',
        asset_account_id: 'asset-account', accumulated_depreciation_account_id: 'accum-account', status: 'active',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        { id: 'gain-account', system_code: 'fixed_asset_disposal_gain', account_type: 'income' },
        { id: 'loss-account', system_code: 'fixed_asset_disposal_loss', account_type: 'expense' },
      ], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [
        { id: 'asset-account', account_type: 'asset', system_code: 'fixed_assets' },
        { id: 'accum-account', account_type: 'asset', system_code: 'accumulated_depreciation' },
        { id: 'bank-account', account_type: 'asset', system_code: 'bank' },
      ], rowCount: 3 })
      .mockResolvedValueOnce({ rows: [{ next_number: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'journal-1' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'asset-1', status: 'disposed', disposal_proceeds: '1200' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await service.disposeFixedAsset(
      { userId: 'user-1', companyId: 'company-1' } as any, 'asset-1',
      { disposalDate: '2027-01-15', proceeds: 1200, paymentAccountId: 'bank-account' } as any,
    );

    expect(result.status).toBe('disposed');
    const lineCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO journal_entry_lines'));
    expect(lineCalls.map(([,params])=>params)).toEqual([
      ['company-1','journal-1','accum-account','Clear accumulated depreciation - LAPTOP-001',100,0],
      ['company-1','journal-1','bank-account','Disposal proceeds - LAPTOP-001',1200,0],
      ['company-1','journal-1','asset-account','Remove asset cost - LAPTOP-001',0,1200],
      ['company-1','journal-1','gain-account','Gain on disposal - LAPTOP-001',0,100],
    ]);
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'accounting.fixed_asset.dispose', entityId: 'asset-1',
    }));
  });
});
