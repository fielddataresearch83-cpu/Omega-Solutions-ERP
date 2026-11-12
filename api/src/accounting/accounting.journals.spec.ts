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
  return { service, db, client, audit };
}

describe('AccountingService manual journals', () => {
  it('rejects unbalanced journals before opening a transaction', async () => {
    const { service, db } = setup();
    await expect(service.createJournal({ userId: 'user-1', companyId: 'company-1' } as any, {
      entryDate: '2026-11-12', description: 'Opening adjustment',
      lines: [
        { accountId: 'cash-account', debit: 100, credit: 0 },
        { accountId: 'equity-account', debit: 0, credit: 90 },
      ],
    } as any)).rejects.toThrow(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('posts a balanced manual journal with company-scoped active accounts and an audit event', async () => {
    const { service, db, client, audit } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'cash-account' }, { id: 'equity-account' }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ next_number: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'journal-1' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'journal-1', entry_number: 'JE-2026-000001' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await service.createJournal({ userId: 'user-1', companyId: 'company-1' } as any, {
      entryDate: '2026-11-12', description: 'Opening capital',
      lines: [
        { accountId: 'cash-account', debit: 1000, credit: 0 },
        { accountId: 'equity-account', debit: 0, credit: 1000 },
      ],
    } as any);

    expect(result.id).toBe('journal-1');
    expect(client.query.mock.calls[0][0]).toContain('company_id=$1');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("'manual_journal'"))).toBe(true);
    expect(client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO journal_entry_lines'))).toHaveLength(2);
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'accounting.journal.create', entityType: 'journal_entry', entityId: 'journal-1',
    }));
  });

  it('creates an equal-and-opposite posted reversal and preserves the original posted entry', async () => {
    const { service, db, client, audit } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'journal-1', entry_number: 'JE-2026-000001', description: 'Opening capital', status: 'posted', reversal_journal_id: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        { account_id: 'cash-account', description: 'Cash', debit: '1000', credit: '0' },
        { account_id: 'equity-account', description: 'Capital', debit: '0', credit: '1000' },
      ], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ next_number: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'reversal-1' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'reversal-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await service.reverseJournal({ userId: 'user-1', companyId: 'company-1' } as any, 'journal-1', '2026-11-12');

    expect(result.id).toBe('reversal-1');
    const lineCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO journal_entry_lines'));
    expect(lineCalls[0][1]).toEqual(['company-1', 'reversal-1', 'cash-account', 'Reversal: Cash', 0, 1000]);
    expect(lineCalls[1][1]).toEqual(['company-1', 'reversal-1', 'equity-account', 'Reversal: Capital', 1000, 0]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE journal_entries SET reversal_journal_id'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("status='reversed'"))).toBe(false);
    expect(audit.logInTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'accounting.journal.reverse', entityId: 'journal-1',
    }));
  });

  it('prevents a second reversal of the same journal', async () => {
    const { service, db, client } = setup();
    client.query.mockResolvedValueOnce({ rows: [{
      id: 'journal-1', entry_number: 'JE-2026-000001', description: 'Already reversed',
      status: 'posted', reversal_journal_id: 'reversal-1',
    }], rowCount: 1 });
    await expect(service.reverseJournal({ userId: 'user-1', companyId: 'company-1' } as any, 'journal-1'))
      .rejects.toThrow(ConflictException);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('AccountingService VAT summary', () => {
  it('reports output VAT, recoverable input VAT and net payable from posted ledger lines', async () => {
    const { service, db } = setup();
    db.query
      .mockResolvedValueOnce({ rows: [{ currency: 'KES' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ input_vat: '1200.00', output_vat: '2500.00' }], rowCount: 1 });

    const result = await service.vatSummary({ userId: 'user-1', companyId: 'company-1' } as any, '2026-01-01', '2026-11-12');

    expect(result).toEqual({
      companyId: 'company-1', currency: 'KES', startDate: '2026-01-01', endDate: '2026-11-12',
      inputVat: 1200, outputVat: 2500, netVatPayable: 1300,
    });
    expect(db.query.mock.calls[1][0]).toContain("j.status='posted'");
    expect(db.query.mock.calls[1][0]).toContain("a.system_code IN ('input_tax','output_tax')");
  });
});


describe('AccountingService withholding tax schedule', () => {
  it('returns supplier PINs, certificates and gross/net settlement totals', async () => {
    const { service, db } = setup();
    db.query
      .mockResolvedValueOnce({ rows: [{ currency: 'KES' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        payment_date: '2026-11-12', supplier_name: 'Acme Supplies', kra_pin: 'A123456789B',
        bill_number: 'BILL-1', supplier_invoice_number: 'INV-1', amount: '1000.00',
        cash_amount: '900.00', withholding_tax_amount: '100.00',
        withholding_certificate_number: 'WHT-001', reference: 'BANK-001',
      }], rowCount: 1 });

    const result = await service.withholdingTaxSchedule(
      { userId: 'user-1', companyId: 'company-1' } as any,
      '2026-11-01', '2026-11-30',
    );

    expect(result.totalGrossPayments).toBe(1000);
    expect(result.totalCashPaid).toBe(900);
    expect(result.totalWithholdingTax).toBe(100);
    expect(result.payments[0].kra_pin).toBe('A123456789B');
    expect(db.query.mock.calls[1][0]).toContain('withholding_certificate_number');
    expect(db.query.mock.calls[1][0]).toContain('s.kra_pin');
  });
});
