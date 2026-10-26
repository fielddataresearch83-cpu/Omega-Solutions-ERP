import { BadRequestException } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service.js';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

const user: AuthenticatedUser = {
  userId: 'user-a', email: 'a@example.test', fullName: 'User A',
  companyId: 'company-a', branchId: null, role: 'owner',
  permissions: ['credit-notes:read', 'credit-notes:write'],
};

describe('CreditNotesService', () => {
  it('scopes credit note listing to the authenticated company', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'cn-a', company_id: 'company-a' }], rowCount: 1 }) };
    const memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-a', branchId: null, role: 'owner' }), getMembership: vi.fn() };
    const service = new CreditNotesService(
      db as unknown as DatabaseService,
      memberships as unknown as MembershipsService,
      { log: vi.fn() } as unknown as AuditService,
      { ensureDefaults: vi.fn() } as unknown as AccountingService,
    );

    const result = await service.list(user);

    expect(result).toHaveLength(1);
    expect(db.query.mock.calls[0][0]).toContain('WHERE cn.company_id=$1');
    expect(db.query.mock.calls[0][1]).toEqual(['company-a', null]);
    expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-a', 'company-a');
  });

  it('rejects credits that exceed the remaining unpaid balance before inserting a note or journal', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'invoice-a', customer_id: 'customer-a', invoice_number: 'INV-2026-00001',
            issue_date: '2026-10-01', status: 'sent', total: '100.00',
            amount_paid: '60.00', credited_amount: '10.00',
          }], rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ id: 'invoice-line-a', description: 'Item A', quantity: '2.000', unit_price: '40.00', tax_rate: '0.00', tax_treatment: 'zero_rated' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ quantity: '0', subtotal: '0', tax: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ amount: '0.00' }], rowCount: 1 }),
    };
    const db = {
      query: vi.fn(),
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(client)),
    };
    const memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-a', branchId: null, role: 'owner' }), getMembership: vi.fn() };
    const accounting = { ensureDefaults: vi.fn().mockResolvedValue(undefined) };
    const service = new CreditNotesService(
      db as unknown as DatabaseService,
      memberships as unknown as MembershipsService,
      { log: vi.fn() } as unknown as AuditService,
      accounting as unknown as AccountingService,
    );

    await expect(service.create(user, {
      invoiceId: 'invoice-a',
      issueDate: '2026-10-17',
      reason: 'Price correction',
      items: [{ invoiceItemId: 'invoice-line-a', description: 'Credit adjustment', quantity: 1 }],
    })).rejects.toThrow(BadRequestException);

    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls[0][1]).toEqual(['invoice-a', 'company-a']);
    expect(client.query.mock.calls[1][1]).toEqual(['company-a', 'invoice-a', ['invoice-line-a']]);
    expect(accounting.ensureDefaults).not.toHaveBeenCalled();
  });

  it('rejects duplicate references to the same original invoice line in one credit note', async () => {
    const db = {
      query: vi.fn(),
      transaction: vi.fn(),
    };
    const memberships = {
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-a', branchId: null, role: 'owner' }),
      getMembership: vi.fn(),
    };
    const accounting = { ensureDefaults: vi.fn() };
    const service = new CreditNotesService(
      db as unknown as DatabaseService,
      memberships as unknown as MembershipsService,
      { log: vi.fn() } as unknown as AuditService,
      accounting as unknown as AccountingService,
    );

    await expect(service.create(user, {
      invoiceId: 'invoice-a',
      issueDate: '2026-10-17',
      reason: 'Duplicate line test',
      items: [
        { invoiceItemId: 'invoice-line-a', description: 'First credit', quantity: 1 },
        { invoiceItemId: 'invoice-line-a', description: 'Second credit', quantity: 1 },
      ],
    })).rejects.toThrow('Each original invoice line can only appear once per credit note.');

    expect(db.transaction).not.toHaveBeenCalled();
    expect(accounting.ensureDefaults).not.toHaveBeenCalled();
  });

  it('limits branch-bound credit note creation to invoices sold through that branch', async () => {
    const branchUser: AuthenticatedUser = { ...user, branchId: 'branch-a', role: 'staff' };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'invoice-other-branch', customer_id: 'customer-a', invoice_number: 'INV-2026-00002',
            issue_date: '2026-10-01', status: 'sent', total: '500.00',
            amount_paid: '0.00', credited_amount: '0.00',
          }], rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };
    const db = {
      query: vi.fn(),
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(client)),
    };
    const memberships = {
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-a', branchId: 'branch-a', role: 'staff' }),
      getMembership: vi.fn(),
    };
    const accounting = { ensureDefaults: vi.fn().mockResolvedValue(undefined) };
    const service = new CreditNotesService(
      db as unknown as DatabaseService,
      memberships as unknown as MembershipsService,
      { log: vi.fn() } as unknown as AuditService,
      accounting as unknown as AccountingService,
    );

    await expect(service.create(branchUser, {
      invoiceId: 'invoice-other-branch',
      issueDate: '2026-10-17',
      reason: 'Price correction',
      items: [{ invoiceItemId: 'invoice-line-a', description: 'Credit adjustment', quantity: 1 }],
    })).rejects.toThrow('Invoice not found in this branch.');

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[1][1]).toEqual(['company-a', 'invoice-other-branch', 'branch-a']);
    expect(accounting.ensureDefaults).not.toHaveBeenCalled();
  });

  it('posts a balanced revenue, tax, and receivables journal for a valid credit', async () => {
    const journalLines: unknown[][] = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE')) {
          return { rows: [{ id: 'invoice-a', customer_id: 'customer-a', invoice_number: 'INV-2026-00001', issue_date: '2026-10-01', status: 'sent', total: '500.00', amount_paid: '0.00', credited_amount: '0.00' }], rowCount: 1 };
        }
        if (sql.includes('FROM invoice_items') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'invoice-line-a', description: 'Adjustment', quantity: '2.000', unit_price: '100.00', tax_rate: '16.00', tax_treatment: 'standard' }], rowCount: 1 };
        if (sql.includes('SELECT COALESCE(SUM(cni.quantity)')) return { rows: [{ quantity: '0', subtotal: '0', tax: '0' }], rowCount: 1 };
        if (sql.includes("status='pending'")) return { rows: [{ amount: '0.00' }], rowCount: 1 };
        if (sql.includes('INSERT INTO credit_note_sequences')) return { rows: [{ next_number: 1 }], rowCount: 1 };
        if (sql.includes('INSERT INTO credit_notes(')) return { rows: [{ id: 'credit-a' }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entry_sequences')) return { rows: [{ next_number: 1 }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entries(')) return { rows: [{ id: 'journal-a' }], rowCount: 1 };
        if (sql.includes('SELECT id FROM chart_of_accounts')) return { rows: [{ id: 'account-' + String(params[1]) }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entry_lines')) journalLines.push(params);
        return { rows: [], rowCount: 1 };
      }),
    };
    const detail = {
      id: 'credit-a', company_id: 'company-a', invoice_id: 'invoice-a', customer_id: 'customer-a',
      customer_name: 'Customer A', invoice_number: 'INV-2026-00001', credit_note_number: 'CN-2026-00001',
      issue_date: '2026-10-17', reason: 'Price correction', subtotal: '100.00', tax_amount: '16.00', total: '116.00',
      created_at: '2026-10-17T10:00:00Z',
    };
    const db = {
      query: vi.fn(async (sql: string) => sql.includes('FROM credit_notes cn')
        ? { rows: [detail], rowCount: 1 }
        : { rows: [{ id: 'line-a', description: 'Adjustment', quantity: '1.000', unit_price: '100.00', tax_rate: '16.00', line_subtotal: '100.00', tax_amount: '16.00', line_total: '116.00' }], rowCount: 1 }),
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(client)),
    };
    const memberships = { getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-a', branchId: null, role: 'owner' }), getMembership: vi.fn() };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new CreditNotesService(
      db as unknown as DatabaseService,
      memberships as unknown as MembershipsService,
      audit as unknown as AuditService,
      { ensureDefaults: vi.fn().mockResolvedValue(undefined) } as unknown as AccountingService,
    );

    const result = await service.create(user, {
      invoiceId: 'invoice-a', issueDate: '2026-10-17', reason: 'Price correction',
      items: [{ invoiceItemId: 'invoice-line-a', description: 'Adjustment', quantity: 1 }],
    });

    expect(result.credit_note_number).toBe('CN-2026-00001');
    expect(result.total).toBe('116.00');
    expect(journalLines).toHaveLength(3);
    const debits = journalLines.reduce((sum, line) => sum + Number(line[4]), 0);
    const credits = journalLines.reduce((sum, line) => sum + Number(line[5]), 0);
    expect(debits).toBe(116);
    expect(credits).toBe(116);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'credit_note.create', companyId: 'company-a' }));
  });

  it.each(['zero_rated', 'exempt'])('posts a balanced zero-tax journal for %s credits', async (treatment) => {
    const lines: unknown[][] = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('INSERT INTO journal_entry_sequences')) return { rows: [{ next_number: 2 }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entries(')) return { rows: [{ id: 'journal-zero-tax' }], rowCount: 1 };
        if (sql.includes('SELECT id FROM chart_of_accounts')) return { rows: [{ id: 'account-' + String(params[1]) }], rowCount: 1 };
        if (sql.includes('INSERT INTO journal_entry_lines')) lines.push(params);
        return { rows: [], rowCount: 1 };
      }),
    };
    const service = new CreditNotesService(
      {} as DatabaseService,
      {} as MembershipsService,
      {} as AuditService,
      {} as AccountingService,
    );
    const posting = service as unknown as {
      postJournal: (client: unknown, input: {
        companyId: string; date: string; description: string; sourceId: string; userId: string;
        subtotal: number; tax: number; total: number;
      }) => Promise<void>;
    };
    await posting.postJournal(client, {
      companyId: 'company-a', date: '2026-10-17', description: `Credit ${treatment}`,
      sourceId: 'credit-zero-tax', userId: 'user-a', subtotal: 100, tax: 0, total: 100,
    });
    expect(lines).toHaveLength(2);
    expect(lines.reduce((sum, line) => sum + Number(line[4]), 0)).toBe(100);
    expect(lines.reduce((sum, line) => sum + Number(line[5]), 0)).toBe(100);
    expect(lines.every(line => Number(line[4]) >= 0 && Number(line[5]) >= 0)).toBe(true);
  });

});
