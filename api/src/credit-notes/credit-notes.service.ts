import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateCreditNoteDto } from './dto/credit-note.dto.js';

@Injectable()
export class CreditNotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
    private readonly accounting: AccountingService,
  ) {}

  private async companyFor(user: AuthenticatedUser) {
    return user.companyId
      ? this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : this.memberships.getMembership(user.userId);
  }

  private async postJournal(client: PoolClient, input: {
    companyId: string; date: string; description: string; sourceId: string; userId: string;
    subtotal: number; tax: number; total: number;
  }) {
    const year = Number(input.date.slice(0, 4));
    const seq = await client.query<{ next_number: number }>(
      `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
       ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1
       RETURNING next_number`, [input.companyId, year],
    );
    const number = `JE-${year}-${String(seq.rows[0].next_number).padStart(6, '0')}`;
    const entry = await client.query<{ id: string }>(
      `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
       VALUES($1,$2,$3,$4,'credit_note',$5,'posted',NOW(),$6) RETURNING id`,
      [input.companyId, number, input.date, input.description, input.sourceId, input.userId],
    );
    const lines = [
      { system: 'sales_revenue', debit: input.subtotal, credit: 0, description: 'Sales returns and allowances' },
      { system: 'output_tax', debit: input.tax, credit: 0, description: 'Reverse output tax on credit' },
      { system: 'accounts_receivable', debit: 0, credit: input.total, description: 'Reduce customer receivable' },
    ].filter(line => line.debit > 0 || line.credit > 0);
    let debit = 0, credit = 0;
    for (const line of lines) {
      const account = await client.query<{ id: string }>(
        'SELECT id FROM chart_of_accounts WHERE company_id=$1 AND system_code=$2 AND is_active=true',
        [input.companyId, line.system],
      );
      if (!account.rows[0]) throw new BadRequestException(`Required accounting account "${line.system}" is missing or inactive.`);
      await client.query(
        'INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6)',
        [input.companyId, entry.rows[0].id, account.rows[0].id, line.description, line.debit, line.credit],
      );
      debit += line.debit; credit += line.credit;
    }
    if (debit <= 0 || Math.abs(debit - credit) > 0.005) throw new BadRequestException('Credit note journal is not balanced.');
  }

  async list(user: AuthenticatedUser) {
    const { companyId, branchId } = await this.companyFor(user);
    return (await this.db.query(
      `SELECT cn.id,cn.company_id,cn.invoice_id,cn.customer_id,c.name AS customer_name,
        i.invoice_number,cn.credit_note_number,cn.issue_date,cn.reason,cn.subtotal,cn.tax_amount,cn.total,cn.created_at
       FROM credit_notes cn
       JOIN invoices i ON i.id=cn.invoice_id AND i.company_id=cn.company_id
       JOIN customers c ON c.id=cn.customer_id AND c.company_id=cn.company_id
       WHERE cn.company_id=$1 AND ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM pos_sales ps
         JOIN pos_registers pr ON pr.id=ps.register_id AND pr.company_id=ps.company_id
         WHERE ps.company_id=cn.company_id AND ps.invoice_id=cn.invoice_id AND pr.branch_id=$2::uuid
       )) ORDER BY cn.created_at DESC`, [companyId, branchId ?? null],
    )).rows;
  }

  async getById(user: AuthenticatedUser, id: string) {
    const { companyId, branchId } = await this.companyFor(user);
    const result = await this.db.query(
      `SELECT cn.id,cn.company_id,cn.invoice_id,cn.customer_id,c.name AS customer_name,
        i.invoice_number,cn.credit_note_number,cn.issue_date,cn.reason,cn.subtotal,cn.tax_amount,cn.total,cn.created_at
       FROM credit_notes cn
       JOIN invoices i ON i.id=cn.invoice_id AND i.company_id=cn.company_id
       JOIN customers c ON c.id=cn.customer_id AND c.company_id=cn.company_id
       WHERE cn.company_id=$1 AND cn.id=$2 AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM pos_sales ps
         JOIN pos_registers pr ON pr.id=ps.register_id AND pr.company_id=ps.company_id
         WHERE ps.company_id=cn.company_id AND ps.invoice_id=cn.invoice_id AND pr.branch_id=$3::uuid
       ))`, [companyId, id, branchId ?? null],
    );
    if (!result.rows[0]) throw new NotFoundException('Credit note not found.');
    const items = await this.db.query(
      'SELECT id,description,quantity,unit_price,tax_rate,line_subtotal,tax_amount,line_total FROM credit_note_items WHERE company_id=$1 AND credit_note_id=$2 ORDER BY created_at,id',
      [companyId, id],
    );
    return { ...result.rows[0], items: items.rows };
  }

  async create(user: AuthenticatedUser, dto: CreateCreditNoteDto) {
    const { companyId, branchId } = await this.companyFor(user);
    const issueDate = dto.issueDate.slice(0, 10);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('A credit note reason is required.');
    if (!dto.items?.length) throw new BadRequestException('Add at least one credit note line.');

    const calculated = dto.items.map(item => {
      const quantity = Math.round(Number(item.quantity) * 1000) / 1000;
      const unitPrice = Math.round(Number(item.unitPrice) * 100) / 100;
      const taxRate = Math.round(Number(item.taxRate ?? 0) * 100) / 100;
      const subtotal = Math.round(quantity * unitPrice * 100) / 100;
      const tax = Math.round(subtotal * taxRate) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      if (!item.description.trim() || quantity <= 0 || unitPrice <= 0 || taxRate < 0 || taxRate > 100 || subtotal <= 0) {
        throw new BadRequestException('Each credit note line needs a description, positive quantity and price, and a valid tax rate.');
      }
      return { description: item.description.trim(), quantity, unitPrice, taxRate, subtotal, tax, total };
    });
    const subtotal = Math.round(calculated.reduce((sum, item) => sum + item.subtotal, 0) * 100) / 100;
    const tax = Math.round(calculated.reduce((sum, item) => sum + item.tax, 0) * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    await this.accounting.ensureDefaults(companyId);

    const created = await this.db.transaction(async client => {
      const invoiceResult = await client.query<{
        id: string; customer_id: string; invoice_number: string; issue_date: string; status: string;
        total: string | number; amount_paid: string | number; credited_amount: string | number;
      }>(
        `SELECT id,customer_id,invoice_number,issue_date,status,total,amount_paid,credited_amount
         FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`, [dto.invoiceId, companyId],
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) throw new NotFoundException('Invoice not found in this company.');
      if (branchId) {
        const branchInvoice = await client.query(
          `SELECT 1 FROM pos_sales ps
           JOIN pos_registers pr ON pr.id=ps.register_id AND pr.company_id=ps.company_id
           WHERE ps.company_id=$1 AND ps.invoice_id=$2 AND pr.branch_id=$3 LIMIT 1`,
          [companyId, invoice.id, branchId],
        );
        if (!branchInvoice.rows[0]) throw new NotFoundException('Invoice not found in this branch.');
      }
      if (invoice.status === 'draft' || invoice.status === 'cancelled') {
        throw new BadRequestException('Credit notes can only be issued against sent or settled invoices.');
      }
      const pendingResult = await client.query<{ amount: string | number }>(
        "SELECT COALESCE(SUM(amount),0) AS amount FROM invoice_payments WHERE company_id=$1 AND invoice_id=$2 AND status='pending'",
        [companyId, invoice.id],
      );
      const pendingPayments = Number(pendingResult.rows[0]?.amount ?? 0);
      const remaining = Math.round((Number(invoice.total) - Number(invoice.amount_paid) - Number(invoice.credited_amount) - pendingPayments) * 100) / 100;
      if (total > remaining + 0.005) {
        throw new BadRequestException(`Credit total ${total.toFixed(2)} exceeds the remaining unpaid invoice balance after pending payment reports of ${Math.max(0, remaining).toFixed(2)}.`);
      }
      const year = Number(issueDate.slice(0, 4));
      const sequence = await client.query<{ next_number: number }>(
        `INSERT INTO credit_note_sequences(company_id,credit_year,next_number) VALUES($1,$2,1)
         ON CONFLICT(company_id,credit_year) DO UPDATE SET next_number=credit_note_sequences.next_number+1
         RETURNING next_number`, [companyId, year],
      );
      const number = `CN-${year}-${String(sequence.rows[0].next_number).padStart(5, '0')}`;
      const note = await client.query<{ id: string }>(
        `INSERT INTO credit_notes(company_id,invoice_id,customer_id,credit_note_number,issue_date,reason,subtotal,tax_amount,total,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [companyId, invoice.id, invoice.customer_id, number, issueDate, reason, subtotal, tax, total, user.userId],
      );
      for (const item of calculated) {
        await client.query(
          `INSERT INTO credit_note_items(company_id,credit_note_id,description,quantity,unit_price,tax_rate,line_subtotal,tax_amount,line_total)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [companyId, note.rows[0].id, item.description, item.quantity, item.unitPrice, item.taxRate, item.subtotal, item.tax, item.total],
        );
      }
      await this.postJournal(client, {
        companyId, date: issueDate, description: `Credit note ${number} against invoice ${invoice.invoice_number}`,
        sourceId: note.rows[0].id, userId: user.userId, subtotal, tax, total,
      });
      await client.query('UPDATE invoices SET credited_amount=credited_amount+$1,updated_at=NOW() WHERE id=$2 AND company_id=$3', [total, invoice.id, companyId]);
      await client.query(
        'UPDATE customers SET outstanding_balance=GREATEST(0,outstanding_balance-$1),updated_at=NOW() WHERE id=$2 AND company_id=$3',
        [total, invoice.customer_id, companyId],
      );
      return note.rows[0];
    });
    await this.audit.log({
      userId: user.userId, companyId, branchId: branchId ?? null, action: 'credit_note.create',
      entityType: 'credit_note', entityId: created.id, oldValues: null,
      newValues: { invoiceId: dto.invoiceId, reason, subtotal, tax, total, issueDate }, ipAddress: null,
    });
    return this.getById(user, created.id);
  }
}
