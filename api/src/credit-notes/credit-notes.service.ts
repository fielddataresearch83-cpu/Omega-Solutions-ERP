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
    subtotal: number; tax: number; total: number; receivableAmount: number; customerCreditAmount: number;
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
      { system: 'accounts_receivable', debit: 0, credit: input.receivableAmount, description: 'Reduce customer receivable' },
      { system: 'customer_credits', debit: 0, credit: input.customerCreditAmount, description: 'Customer credit payable for excess credit value' },
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
      'SELECT id,invoice_item_id,description,quantity,unit_price,tax_rate,tax_treatment,line_subtotal,tax_amount,line_total FROM credit_note_items WHERE company_id=$1 AND credit_note_id=$2 ORDER BY created_at,id',
      [companyId, id],
    );
    const creditBalance = await this.db.query(
      `SELECT id,credit_amount,refunded_amount,(credit_amount-refunded_amount)::numeric(14,2) AS available_amount,created_at,updated_at
       FROM customer_credit_balances WHERE company_id=$1 AND credit_note_id=$2`,
      [companyId, id],
    );
    const refunds = creditBalance.rows[0] ? await this.db.query(
      `SELECT id,amount,method,reference,notes,created_by,refunded_at
       FROM customer_credit_refunds WHERE company_id=$1 AND customer_credit_balance_id=$2 ORDER BY refunded_at DESC`,
      [companyId, creditBalance.rows[0].id],
    ) : { rows: [] };
    return { ...result.rows[0], items: items.rows, customerCredit: creditBalance.rows[0] ? { ...creditBalance.rows[0], refunds: refunds.rows } : null };
  }

  async recordRefund(user: AuthenticatedUser, creditNoteId: string, dto: {
    amount: number; method: 'cash' | 'bank' | 'mpesa'; reference: string; notes?: string;
  }) {
    const { companyId, branchId } = await this.companyFor(user);
    const amount = Math.round(Number(dto.amount) * 100) / 100;
    const reference = dto.reference.trim();
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Refund amount must be greater than zero.');
    if (!reference) throw new BadRequestException('A refund transaction reference is required.');
    const refund = await this.db.transaction(async client => {
      const balanceResult = await client.query<{
        id: string; customer_id: string; credit_note_id: string; credit_amount: string | number; refunded_amount: string | number;
      }>(
        `SELECT b.id,b.customer_id,b.credit_note_id,b.credit_amount,b.refunded_amount
         FROM customer_credit_balances b
         JOIN credit_notes cn ON cn.id=b.credit_note_id AND cn.company_id=b.company_id
         WHERE b.company_id=$1 AND b.credit_note_id=$2 FOR UPDATE OF b`,
        [companyId, creditNoteId],
      );
      const balance = balanceResult.rows[0];
      if (!balance) throw new NotFoundException('No refundable customer credit exists for this credit note.');
      if (branchId) {
        const branchInvoice = await client.query(
          `SELECT 1 FROM pos_sales ps JOIN pos_registers pr ON pr.id=ps.register_id AND pr.company_id=ps.company_id
           JOIN credit_notes cn ON cn.invoice_id=ps.invoice_id AND cn.company_id=ps.company_id
           WHERE cn.company_id=$1 AND cn.id=$2 AND pr.branch_id=$3 LIMIT 1`,
          [companyId, creditNoteId, branchId],
        );
        if (!branchInvoice.rows[0]) throw new NotFoundException('Credit note not found in this branch.');
      }
      const available = Math.round((Number(balance.credit_amount) - Number(balance.refunded_amount)) * 100) / 100;
      if (amount > available + 0.005) throw new BadRequestException(`Refund exceeds the available customer credit of ${available.toFixed(2)}.`);
      await this.accounting.ensureDefaults(companyId);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO customer_credit_refunds(company_id,customer_credit_balance_id,amount,method,reference,notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [companyId, balance.id, amount, dto.method, reference, dto.notes?.trim() || null, user.userId],
      );
      const year = new Date().getFullYear();
      const seq = await client.query<{ next_number: number }>(
        `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
         ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,
        [companyId, year],
      );
      const entryNumber = `JE-${year}-${String(seq.rows[0].next_number).padStart(6, '0')}`;
      const journal = await client.query<{ id: string }>(
        `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
         VALUES($1,$2,CURRENT_DATE,$3,'customer_credit_refund',$4,'posted',NOW(),$5) RETURNING id`,
        [companyId, entryNumber, `Refund customer credit against credit note ${creditNoteId}`, inserted.rows[0].id, user.userId],
      );
      const assetSystem = dto.method === 'cash' ? 'cash' : dto.method === 'mpesa' ? 'mpesa' : 'bank';
      for (const line of [
        { system: 'customer_credits', debit: amount, credit: 0, description: 'Reduce customer credit liability' },
        { system: assetSystem, debit: 0, credit: amount, description: 'Refund paid to customer' },
      ]) {
        const account = await client.query<{ id: string }>(
          'SELECT id FROM chart_of_accounts WHERE company_id=$1 AND system_code=$2 AND is_active=true',
          [companyId, line.system],
        );
        if (!account.rows[0]) throw new BadRequestException(`Required accounting account "${line.system}" is missing or inactive.`);
        await client.query(
          'INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6)',
          [companyId, journal.rows[0].id, account.rows[0].id, line.description, line.debit, line.credit],
        );
      }
      await client.query(
        'UPDATE customer_credit_balances SET refunded_amount=refunded_amount+$1,updated_at=NOW() WHERE id=$2 AND company_id=$3',
        [amount, balance.id, companyId],
      );
      return inserted.rows[0];
    });
    await this.audit.log({
      userId: user.userId, companyId, branchId: branchId ?? null, action: 'credit_note.refund',
      entityType: 'customer_credit_refund', entityId: refund.id, oldValues: null,
      newValues: { creditNoteId, amount, method: dto.method, reference }, ipAddress: null,
    });
    return this.getById(user, creditNoteId);
  }

  async create(user: AuthenticatedUser, dto: CreateCreditNoteDto) {
    const { companyId, branchId } = await this.companyFor(user);
    const issueDate = dto.issueDate.slice(0, 10);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('A credit note reason is required.');
    if (!dto.items?.length) throw new BadRequestException('Add at least one credit note line.');

    const requestedItems = dto.items.map(item => {
      const quantity = Math.round(Number(item.quantity) * 1000) / 1000;
      if (!item.description.trim() || !Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('Each credit line must have a description and a positive quantity.');
      }
      if (!item.invoiceItemId) {
        throw new BadRequestException('Each credit line must reference an original invoice line.');
      }
      return { invoiceItemId: item.invoiceItemId, description: item.description.trim(), quantity };
    });
    if (new Set(requestedItems.map(item => item.invoiceItemId)).size !== requestedItems.length) {
      throw new BadRequestException('Each original invoice line can only appear once per credit note.');
    }
    let calculated: Array<{
      invoiceItemId: string; description: string; quantity: number; unitPrice: number;
      taxRate: number; taxTreatment: string; subtotal: number; tax: number; total: number;
    }> = [];
    let subtotal = 0;
    let tax = 0;
    let total = 0;
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
      const originalLines = await client.query<{
        id: string; description: string; quantity: string | number; unit_price: string | number;
        tax_rate: string | number; tax_treatment: string;
      }>(
        `SELECT id, product_name AS description, quantity, unit_price, tax_rate, tax_treatment
         FROM invoice_items
         WHERE company_id=$1 AND invoice_id=$2 AND id = ANY($3::uuid[])
         FOR UPDATE`,
        [companyId, invoice.id, requestedItems.map(item => item.invoiceItemId)],
      );
      if (originalLines.rows.length !== new Set(requestedItems.map(item => item.invoiceItemId)).size) {
        throw new BadRequestException('Every credit line must reference a distinct line from the selected original invoice.');
      }
      calculated = [];
      for (const requested of requestedItems) {
        const original = originalLines.rows.find(line => line.id === requested.invoiceItemId);
        if (!original) throw new BadRequestException('The selected original invoice line was not found.');
        const credited = await client.query<{ quantity: string | number; subtotal: string | number; tax: string | number }>(
          `SELECT COALESCE(SUM(cni.quantity),0) AS quantity,
             COALESCE(SUM(cni.line_subtotal),0) AS subtotal,
             COALESCE(SUM(cni.tax_amount),0) AS tax
           FROM credit_note_items cni
           JOIN credit_notes cn ON cn.id=cni.credit_note_id AND cn.company_id=cni.company_id
           WHERE cni.company_id=$1 AND cn.invoice_id=$2 AND cni.invoice_item_id=$3`,
          [companyId, invoice.id, original.id],
        );
        const previouslyCreditedQty = Number(credited.rows[0]?.quantity ?? 0);
        const previouslyCreditedSubtotal = Number(credited.rows[0]?.subtotal ?? 0);
        const originalQty = Number(original.quantity);
        const remainingQty = Math.round((originalQty - previouslyCreditedQty) * 1000) / 1000;
        if (requested.quantity > remainingQty + 0.0001) {
          throw new BadRequestException(`Credit quantity exceeds the remaining eligible quantity (${Math.max(0, remainingQty).toFixed(3)}) for invoice line ${original.id}.`);
        }
        const unitPrice = Math.round(Number(original.unit_price) * 100) / 100;
        const taxRate = Math.round(Number(original.tax_rate) * 100) / 100;
        const lineSubtotal = Math.round(requested.quantity * unitPrice * 100) / 100;
        const remainingLineValue = Math.round((Number(original.quantity) * unitPrice - previouslyCreditedSubtotal) * 100) / 100;
        if (lineSubtotal > remainingLineValue + 0.005) {
          throw new BadRequestException('Credit value exceeds the remaining eligible value of the original invoice line.');
        }
        const lineTax = Math.round(lineSubtotal * taxRate) / 100;
        const lineTotal = Math.round((lineSubtotal + lineTax) * 100) / 100;
        calculated.push({
          invoiceItemId: original.id,
          description: requested.description,
          quantity: requested.quantity,
          unitPrice,
          taxRate,
          taxTreatment: original.tax_treatment ?? 'legacy',
          subtotal: lineSubtotal,
          tax: lineTax,
          total: lineTotal,
        });
      }
      subtotal = Math.round(calculated.reduce((sum, item) => sum + item.subtotal, 0) * 100) / 100;
      tax = Math.round(calculated.reduce((sum, item) => sum + item.tax, 0) * 100) / 100;
      total = Math.round((subtotal + tax) * 100) / 100;
      if (subtotal <= 0 || total <= 0) throw new BadRequestException('Credit note must have a positive subtotal and total.');
      const pendingResult = await client.query<{ amount: string | number }>(
        "SELECT COALESCE(SUM(amount),0) AS amount FROM invoice_payments WHERE company_id=$1 AND invoice_id=$2 AND status='pending'",
        [companyId, invoice.id],
      );
      const pendingPayments = Number(pendingResult.rows[0]?.amount ?? 0);
      // Credit notes may be issued for paid invoices. Reduce receivables only by the
      // amount not already paid or reserved by pending payment reports; the excess is
      // a customer-credit liability and must be refunded/settled separately.
      const remainingReceivable = Math.max(0, Math.round((Number(invoice.total) - Number(invoice.amount_paid) - Number(invoice.credited_amount) - pendingPayments) * 100) / 100);
      const receivableAmount = Math.round(Math.min(total, remainingReceivable) * 100) / 100;
      const customerCreditAmount = Math.round((total - receivableAmount) * 100) / 100;
      // Defaults are only initialized after invoice, branch, line, quantity and balance checks pass.
      await this.accounting.ensureDefaults(companyId);
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
          `INSERT INTO credit_note_items(company_id,credit_note_id,invoice_item_id,description,quantity,unit_price,tax_rate,tax_treatment,line_subtotal,tax_amount,line_total)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [companyId, note.rows[0].id, item.invoiceItemId, item.description, item.quantity, item.unitPrice, item.taxRate, item.taxTreatment, item.subtotal, item.tax, item.total],
        );
      }
      await this.postJournal(client, {
        companyId, date: issueDate, description: `Credit note ${number} against invoice ${invoice.invoice_number}`,
        sourceId: note.rows[0].id, userId: user.userId, subtotal, tax, total, receivableAmount, customerCreditAmount,
      });
      if (customerCreditAmount > 0) {
        await client.query(
          `INSERT INTO customer_credit_balances(company_id,customer_id,credit_note_id,credit_amount)
           VALUES($1,$2,$3,$4)`,
          [companyId, invoice.customer_id, note.rows[0].id, customerCreditAmount],
        );
      }
      await client.query('UPDATE invoices SET credited_amount=credited_amount+$1,updated_at=NOW() WHERE id=$2 AND company_id=$3', [total, invoice.id, companyId]);
      if (receivableAmount > 0) {
        await client.query(
          'UPDATE customers SET outstanding_balance=GREATEST(0,outstanding_balance-$1),updated_at=NOW() WHERE id=$2 AND company_id=$3',
          [receivableAmount, invoice.customer_id, companyId],
        );
      }
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
