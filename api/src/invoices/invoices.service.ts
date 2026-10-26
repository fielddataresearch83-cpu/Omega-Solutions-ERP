import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateInvoiceDto, CreateInvoicePaymentDto } from './dto/invoice.dto.js';
import type { InvoiceItemRow, InvoicePaymentRow, InvoiceRow, InvoiceStatus } from './invoice.types.js';
import type { PoolClient } from 'pg';
import { AccountingService } from '../accounting/accounting.service.js';

const INVOICE_SELECT = `
  SELECT i.id, i.company_id, i.customer_id, c.name AS customer_name,
         i.invoice_number, i.issue_date, i.due_date, i.status,
         i.currency, i.subtotal, i.tax_amount, i.total, i.amount_paid, i.credited_amount,
         i.notes, i.created_at, i.updated_at,
         COUNT(ii.id)::int AS item_count
  FROM invoices i
  JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id
  LEFT JOIN invoice_items ii ON ii.invoice_id = i.id AND ii.company_id = i.company_id
`;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly audit: AuditService,
    private readonly accounting: AccountingService,
  ) {}


  private async postJournal(client: PoolClient, input: {
    companyId: string; date: string | Date | null; description: string; sourceType: string;
    sourceId: string; userId: string;
    lines: Array<{ systemCode: string; debit: number; credit: number; description: string }>;
  }) {
    const journalDate = input.date instanceof Date ? input.date.toISOString().slice(0, 10) : input.date;
    const year = journalDate ? Number(journalDate.slice(0, 4)) : new Date().getFullYear();
    const seq = await client.query<{ next_number: number }>(
      `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
       ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1
       RETURNING next_number`, [input.companyId, year],
    );
    const entryNumber = `JE-${year}-${String(seq.rows[0].next_number).padStart(6, '0')}`;
    const entry = await client.query<{ id: string }>(
      `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
       VALUES($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,'posted',NOW(),$7) RETURNING id`,
      [input.companyId, entryNumber, journalDate, input.description, input.sourceType, input.sourceId, input.userId],
    );
    let debits = 0;
    let credits = 0;
    for (const line of input.lines) {
      if (line.debit <= 0 && line.credit <= 0) continue;
      const account = await client.query<{ id: string }>(
        'SELECT id FROM chart_of_accounts WHERE company_id=$1 AND system_code=$2 AND is_active=true',
        [input.companyId, line.systemCode],
      );
      if (!account.rows[0]) throw new BadRequestException(`Required accounting account "${line.systemCode}" is missing or inactive.`);
      await client.query(
        'INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6)',
        [input.companyId, entry.rows[0].id, account.rows[0].id, line.description, line.debit, line.credit],
      );
      debits += line.debit;
      credits += line.credit;
    }
    if (Math.abs(debits - credits) > 0.005 || debits <= 0) throw new BadRequestException('Journal entry is not balanced.');
    return entry.rows[0].id;
  }

  private async membershipFor(user: AuthenticatedUser) {
    return user.companyId
      ? this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : this.memberships.getMembership(user.userId);
  }

  private async assertBranchInvoiceAccess(membership: { companyId: string; branchId?: string | null }, invoiceId: string) {
    if (!membership.branchId) return;
    const result = await this.db.query<{ id: string }>(
      `SELECT i.id FROM invoices i
       JOIN pos_sales ps ON ps.invoice_id=i.id AND ps.company_id=i.company_id
       JOIN pos_registers pr ON pr.id=ps.register_id AND pr.company_id=ps.company_id
       WHERE i.id=$1 AND i.company_id=$2 AND pr.branch_id=$3
       LIMIT 1`,
      [invoiceId, membership.companyId, membership.branchId],
    );
    if (!result.rows[0]) throw new NotFoundException('Invoice not found.');
  }

  async list(user: AuthenticatedUser, search?: string, status?: string): Promise<InvoiceRow[]> {
    const membership = await this.membershipFor(user);
    const conditions = ['i.company_id = $1'];
    const params: (string | number)[] = [membership.companyId];
    if (membership.branchId) {
      params.push(membership.branchId);
      conditions.push(`EXISTS (
        SELECT 1 FROM pos_sales ps
        JOIN pos_registers pr ON pr.id=ps.register_id AND pr.company_id=ps.company_id
        WHERE ps.company_id=i.company_id AND ps.invoice_id=i.id AND pr.branch_id=${params.length}::uuid
      )`);
    }

    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(i.invoice_number ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    if (status && status !== 'all') {
      if (!this.isInvoiceStatus(status)) throw new BadRequestException('Invalid invoice status.');
      params.push(status);
      conditions.push(`i.status = $${params.length}::invoice_status`);
    }

    const result = await this.db.query<InvoiceRow>(
      `${INVOICE_SELECT}
       WHERE ${conditions.join(' AND ')}
       GROUP BY i.id, c.name
       ORDER BY i.created_at DESC`,
      params,
    );
    return result.rows;
  }

  async getSalesTeamSummary(user: AuthenticatedUser) {
    const membership = await this.membershipFor(user);
    if (membership.branchId) throw new ForbiddenException('Sales team summaries are company-wide. A company-wide sales administrator must access this report.');
    const result = await this.db.query<{
      user_id: string; full_name: string; role: string; invoice_count: number;
      sales_total: string | number; collected_total: string | number; outstanding_total: string | number;
    }>(
      `SELECT u.id AS user_id,u.full_name,m.role::text AS role,
        COUNT(i.id) FILTER (WHERE i.status NOT IN ('draft','cancelled'))::int AS invoice_count,
        COALESCE(SUM(i.total) FILTER (WHERE i.status NOT IN ('draft','cancelled')),0) AS sales_total,
        COALESCE(SUM(i.amount_paid),0) AS collected_total,
        COALESCE(SUM(GREATEST(i.total-i.amount_paid-COALESCE(i.credited_amount,0),0)) FILTER (WHERE i.status NOT IN ('draft','cancelled')),0) AS outstanding_total
       FROM company_memberships m
       JOIN users u ON u.id=m.user_id
       LEFT JOIN invoices i ON i.created_by=u.id AND i.company_id=m.company_id
       WHERE m.company_id=$1 AND m.is_active=TRUE AND u.is_active=TRUE
       GROUP BY u.id,u.full_name,m.role
       ORDER BY sales_total DESC,u.full_name ASC`,
      [membership.companyId],
    );
    return result.rows;
  }

  async getById(user: AuthenticatedUser, invoiceId: string): Promise<InvoiceRow> {
    const membership = await this.membershipFor(user);
    const branchClause = membership.branchId
      ? `AND EXISTS (
          SELECT 1 FROM pos_sales ps
          JOIN pos_registers pr ON pr.id=ps.register_id AND pr.company_id=ps.company_id
          WHERE ps.company_id=i.company_id AND ps.invoice_id=i.id AND pr.branch_id=$3::uuid
        )`
      : '';
    const queryParams = membership.branchId
      ? [membership.companyId, invoiceId, membership.branchId]
      : [membership.companyId, invoiceId];
    const result = await this.db.query<InvoiceRow>(
      `${INVOICE_SELECT}
       WHERE i.company_id = $1 AND i.id = $2 ${branchClause}
       GROUP BY i.id, c.name`,
      queryParams,
    );
    const invoice = result.rows[0];
    if (!invoice) throw new NotFoundException('Invoice not found.');
    const items = await this.db.query<InvoiceItemRow>(
      `SELECT id, invoice_id, product_id, product_name, sku, quantity,
              unit_price, tax_rate, line_subtotal, tax_amount, line_total
       FROM invoice_items WHERE company_id = $1 AND invoice_id = $2
       ORDER BY created_at ASC`,
      [membership.companyId, invoiceId],
    );
    invoice.items = items.rows;
    const payments = await this.db.query<InvoicePaymentRow>(
      `SELECT id, invoice_id, amount, method, reference, paid_at, notes, created_at, status, verified_at, reconciled_at, reconciliation_reference
       FROM invoice_payments WHERE company_id = $1 AND invoice_id = $2
       ORDER BY paid_at DESC, created_at DESC`,
      [membership.companyId, invoiceId],
    );
    invoice.payments = payments.rows;
    return invoice;
  }

  async create(user: AuthenticatedUser, dto: CreateInvoiceDto): Promise<InvoiceRow> {
    const membership = await this.membershipFor(user);
    if (membership.branchId) {
      throw new ForbiddenException('Standalone invoices are not available to branch-bound users. Create invoices through the assigned branch POS workflow.');
    }
    const result = await this.db.transaction(async (client) => {
      const customer = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM customers WHERE id = $1 AND company_id = $2 AND is_active = TRUE FOR SHARE',
        [dto.customerId, membership.companyId],
      );
      if (!customer.rows[0]) throw new BadRequestException('Choose an active customer from your company.');
      if (dto.dueDate < dto.issueDate) throw new BadRequestException('Due date cannot be before issue date.');

      const year = Number(dto.issueDate.slice(0, 4));
      const sequence = await client.query<{ next_number: number }>(
        `INSERT INTO invoice_sequences (company_id, invoice_year, next_number)
         VALUES ($1, $2, 1)
         ON CONFLICT (company_id, invoice_year)
         DO UPDATE SET next_number = invoice_sequences.next_number + 1
         RETURNING next_number`,
        [membership.companyId, year],
      );
      const invoiceNumber = `INV-${year}-${String(sequence.rows[0].next_number).padStart(5, '0')}`;

      let subtotalCents = 0;
      let taxCents = 0;
      const resolved: Array<{
        productId: string; name: string; sku: string; quantity: number;
        unitPriceCents: number; taxRate: number; lineSubtotalCents: number;
        lineTaxCents: number; lineTotalCents: number;
      }> = [];

      for (const item of dto.items) {
        const productResult = await client.query<{
          id: string; name: string; sku: string; selling_price: string | number;
          is_active: boolean; is_service: boolean;
        }>(
          `SELECT id, name, sku, selling_price, is_active, is_service, tax_treatment, tax_rate
           FROM products WHERE id = $1 AND company_id = $2 FOR SHARE`,
          [item.productId, membership.companyId],
        );
        const product = productResult.rows[0];
        if (!product || !product.is_active) {
          throw new BadRequestException('Each invoice item must reference an active product from your company.');
        }
        const unitPriceCents = Math.round(Number(item.unitPrice ?? product.selling_price) * 100);
        const quantityMilli = Math.round(item.quantity * 1000);
        const quantity = quantityMilli / 1000;
        const lineSubtotalCents = Math.round(unitPriceCents * quantityMilli / 1000);
        const taxRate = product.tax_treatment === 'legacy'
          ? (item.taxRate ?? 0)
          : product.tax_treatment === 'standard'
            ? Number(product.tax_rate)
            : 0;
        const lineTaxCents = Math.round(lineSubtotalCents * taxRate / 100);
        const lineTotalCents = lineSubtotalCents + lineTaxCents;
        subtotalCents += lineSubtotalCents;
        taxCents += lineTaxCents;
        resolved.push({
          productId: product.id, name: product.name, sku: product.sku, quantity,
          unitPriceCents, taxRate, lineSubtotalCents, lineTaxCents, lineTotalCents,
        });
      }

      const totalCents = subtotalCents + taxCents;
      const inserted = await client.query<InvoiceRow>(
        `INSERT INTO invoices
          (company_id, customer_id, invoice_number, issue_date, due_date, status,
           currency, subtotal, tax_amount, total, amount_paid, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', 'KES', $6, $7, $8, 0, $9, $10)
         RETURNING id, company_id, customer_id, invoice_number, issue_date, due_date,
                   status, currency, subtotal, tax_amount, total, amount_paid, notes,
                   created_at, updated_at`,
        [
          membership.companyId, dto.customerId, invoiceNumber, dto.issueDate, dto.dueDate,
          subtotalCents / 100, taxCents / 100, totalCents / 100, dto.notes ?? null, user.userId,
        ],
      );
      const invoice = inserted.rows[0];
      for (const item of resolved) {
        await client.query(
          `INSERT INTO invoice_items
            (company_id, invoice_id, product_id, product_name, sku, quantity, unit_price,
             tax_rate, line_subtotal, tax_amount, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            membership.companyId, invoice.id, item.productId, item.name, item.sku, item.quantity,
            item.unitPriceCents / 100, item.taxRate, item.lineSubtotalCents / 100,
            item.lineTaxCents / 100, item.lineTotalCents / 100,
          ],
        );
      }
      return invoice;
    });

    await this.audit.log({
      userId: user.userId, companyId: membership.companyId, branchId: membership.branchId,
      action: 'invoice.create', entityType: 'invoice', entityId: result.id,
      oldValues: null, newValues: { invoiceNumber: result.invoice_number, total: result.total },
      ipAddress: null,
    });
    return this.getById(user, result.id);
  }

  async recordPayment(
    user: AuthenticatedUser,
    invoiceId: string,
    dto: CreateInvoicePaymentDto,
  ): Promise<InvoiceRow> {
    const membership = await this.membershipFor(user);
    await this.assertBranchInvoiceAccess(membership, invoiceId);
    const paymentAmount = Math.round(dto.amount * 100) / 100;
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero.');
    }

    const payment = await this.db.transaction(async (client) => {
      const result = await client.query<{
        status: InvoiceStatus;
        total: string | number;
        amount_paid: string | number;
        credited_amount: string | number;
      }>(
        'SELECT status, total, amount_paid, credited_amount FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [invoiceId, membership.companyId],
      );
      const invoice = result.rows[0];
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.status === 'draft' || invoice.status === 'cancelled') {
        throw new BadRequestException('Only sent invoices can receive payment reports.');
      }
      const pending = await client.query<{ amount: string | number }>(
        "SELECT COALESCE(SUM(amount),0) AS amount FROM invoice_payments WHERE company_id=$1 AND invoice_id=$2 AND status='pending'",
        [membership.companyId, invoiceId],
      );
      const outstandingCents = Math.round((Number(invoice.total) - Number(invoice.amount_paid) - Number(invoice.credited_amount)) * 100);
      const alreadyReportedCents = Math.round(Number(pending.rows[0].amount) * 100);
      const paymentCents = Math.round(paymentAmount * 100);
      if (paymentCents + alreadyReportedCents > outstandingCents) {
        throw new BadRequestException('This report would exceed the remaining balance after other pending payment reports.');
      }

      const inserted = await client.query<InvoicePaymentRow>(
        `INSERT INTO invoice_payments
          (company_id, invoice_id, amount, method, reference, notes, created_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING id, invoice_id, amount, method, reference, paid_at, notes, created_at, status, verified_at, reconciled_at, reconciliation_reference`,
        [
          membership.companyId, invoiceId, paymentAmount, dto.method,
          dto.reference?.trim() || null, dto.notes?.trim() || null, user.userId,
        ],
      );
      return inserted.rows[0];
    });

    await this.audit.log({
      userId: user.userId, companyId: membership.companyId, branchId: membership.branchId,
      action: 'invoice.payment.report', entityType: 'invoice_payment', entityId: payment.id,
      oldValues: null,
      newValues: { invoiceId, amount: payment.amount, method: payment.method, reference: payment.reference, status: 'pending' },
      ipAddress: null,
    });
    return this.getById(user, invoiceId);
  }

  async confirmPayment(
    user: AuthenticatedUser,
    invoiceId: string,
    paymentId: string,
  ): Promise<InvoiceRow> {
    const membership = await this.membershipFor(user);
    await this.assertBranchInvoiceAccess(membership, invoiceId);
    await this.accounting.ensureDefaults(membership.companyId);
    const confirmed = await this.db.transaction(async (client) => {
      const paymentResult = await client.query<InvoicePaymentRow>(
        `SELECT id, invoice_id, amount, method, reference, paid_at, notes, created_at, status, verified_at, reconciled_at, reconciliation_reference
         FROM invoice_payments
         WHERE id=$1 AND invoice_id=$2 AND company_id=$3
         FOR UPDATE`,
        [paymentId, invoiceId, membership.companyId],
      );
      const payment = paymentResult.rows[0];
      if (!payment) throw new NotFoundException('Payment report not found.');
      if (payment.status !== 'pending') {
        throw new BadRequestException('Only pending payment reports can be confirmed.');
      }
      const invoiceResult = await client.query<{
        status: InvoiceStatus; customer_id: string; total: string | number; amount_paid: string | number; credited_amount: string | number;
      }>(
        'SELECT status, customer_id, total, amount_paid, credited_amount FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE',
        [invoiceId, membership.companyId],
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice || invoice.status === 'draft' || invoice.status === 'cancelled') {
        throw new BadRequestException('The invoice is unavailable for payment confirmation.');
      }
      const paymentAmount = Number(payment.amount);
      const paymentCents = Math.round(paymentAmount * 100);
      const newPaidCents = Math.round(Number(invoice.amount_paid) * 100) + paymentCents;
      const totalCents = Math.round((Number(invoice.total) - Number(invoice.credited_amount)) * 100);
      if (newPaidCents > totalCents) {
        throw new BadRequestException('The confirmed amount would exceed the invoice balance.');
      }
      const cashAccount = payment.method === 'cash' ? 'cash' : payment.method === 'mpesa' ? 'mpesa' : 'bank';
      await this.postJournal(client, {
        companyId: membership.companyId, date: null, description: `Confirmed receipt against invoice ${invoiceId}`,
        sourceType: 'invoice_payment', sourceId: payment.id, userId: user.userId,
        lines: [
          { systemCode: cashAccount, debit: paymentAmount, credit: 0, description: 'Confirmed customer receipt' },
          { systemCode: 'accounts_receivable', debit: 0, credit: paymentAmount, description: 'Reduce customer receivable' },
        ],
      });
      const newStatus: InvoiceStatus = newPaidCents >= totalCents ? 'paid' : 'partially_paid';
      await client.query(
        `UPDATE invoice_payments SET status='confirmed', verified_at=NOW(), verified_by=$1, paid_at=NOW()
         WHERE id=$2 AND company_id=$3 AND status='pending'`,
        [user.userId, payment.id, membership.companyId],
      );
      await client.query(
        'UPDATE invoices SET amount_paid=$1, status=$2::invoice_status, updated_at=NOW() WHERE id=$3 AND company_id=$4',
        [newPaidCents / 100, newStatus, invoiceId, membership.companyId],
      );
      await client.query(
        `UPDATE pos_sales SET amount_confirmed=$1,
          status=CASE WHEN $1 >= total THEN 'completed' ELSE 'awaiting_payment_confirmation' END
         WHERE company_id=$2 AND invoice_id=$3`,
        [newPaidCents / 100, membership.companyId, invoiceId],
      );
      await client.query(
        'UPDATE customers SET outstanding_balance=GREATEST(0,outstanding_balance-$1),updated_at=NOW() WHERE id=$2 AND company_id=$3',
        [paymentAmount, invoice.customer_id, membership.companyId],
      );
      return payment;
    });
    await this.audit.log({
      userId: user.userId, companyId: membership.companyId, branchId: membership.branchId,
      action: 'invoice.payment.confirm', entityType: 'invoice_payment', entityId: confirmed.id,
      oldValues: { status: 'pending' },
      newValues: { invoiceId, amount: confirmed.amount, method: confirmed.method, status: 'confirmed' },
      ipAddress: null,
    });
    return this.getById(user, invoiceId);
  }

  private async applyInvoiceStock(
    client: PoolClient,
    input: { companyId: string; invoiceId: string; invoiceNumber: string; userId: string; reverse?: boolean },
  ) {
    const lines = await client.query<{
      product_id: string; quantity: string | number; is_service: boolean; cost_price: string | number;
    }>(
      `SELECT ii.product_id, SUM(ii.quantity)::numeric AS quantity, p.is_service, p.cost_price
       FROM invoice_items ii
       JOIN products p ON p.id=ii.product_id AND p.company_id=ii.company_id
       WHERE ii.company_id=$1 AND ii.invoice_id=$2 AND ii.product_id IS NOT NULL
       GROUP BY ii.product_id,p.is_service,p.cost_price
       ORDER BY ii.product_id`,
      [input.companyId, input.invoiceId],
    );
    let costTotal = 0;
    // POS checkout already issues stock from its selected warehouse. A later
    // invoice cancellation must reverse that same warehouse, not assume MAIN.
    const posWarehouse = await client.query<{ warehouse_id: string | null }>(
      'SELECT warehouse_id FROM pos_sales WHERE company_id=$1 AND invoice_id=$2 ORDER BY created_at ASC LIMIT 1',
      [input.companyId, input.invoiceId],
    );
    let warehouseId = posWarehouse.rows[0]?.warehouse_id ?? null;
    if (!warehouseId) {
      const warehouse = await client.query<{ id: string }>(
        "SELECT id FROM warehouses WHERE company_id=$1 AND code='MAIN' AND is_active=true FOR SHARE",
        [input.companyId],
      );
      if (!warehouse.rows[0]) {
        throw new BadRequestException('An active MAIN warehouse is required before dispatching physical products.');
      }
      warehouseId = warehouse.rows[0].id;
    }
    for (const line of lines.rows) {
      if (line.is_service) continue;
      if (!input.reverse) costTotal += Number(line.quantity) * Number(line.cost_price);
      await client.query(
        `INSERT INTO inventory_stock_levels(company_id,warehouse_id,product_id,quantity,reserved_quantity,reorder_level)
         SELECT $1,$2,p.id,0,0,p.reorder_level FROM products p WHERE p.id=$3 AND p.company_id=$1 AND p.is_service=false
         ON CONFLICT(warehouse_id,product_id) DO NOTHING`,
        [input.companyId, warehouseId, line.product_id],
      );
      const stock = await client.query<{ quantity: string | number; reserved_quantity: string | number }>(
        'SELECT quantity,reserved_quantity FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE',
        [input.companyId, warehouseId, line.product_id],
      );
      if (!stock.rows[0]) throw new BadRequestException('Stock record could not be initialized for an invoice item.');
      const quantity = Number(line.quantity);
      const available = Number(stock.rows[0].quantity) - Number(stock.rows[0].reserved_quantity);
      if (!input.reverse && available < quantity) {
        throw new BadRequestException(`Insufficient available stock for invoice item. Available: ${available}; required: ${quantity}.`);
      }
      if (input.reverse) {
        await client.query(
          'UPDATE inventory_stock_levels SET quantity=quantity+$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4',
          [quantity, input.companyId, warehouseId, line.product_id],
        );
      } else {
        await client.query(
          'UPDATE inventory_stock_levels SET quantity=quantity-$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4',
          [quantity, input.companyId, warehouseId, line.product_id],
        );
      }
      await client.query(
        `INSERT INTO inventory_stock_movements
          (company_id,product_id,warehouse_id,movement_type,quantity,unit_cost,reference,notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.companyId, line.product_id, warehouseId, input.reverse ? 'receipt' : 'issue',
          input.reverse ? quantity : -quantity, Number(line.cost_price) || 0, input.invoiceNumber,
          input.reverse ? 'Stock reversal for cancelled invoice' : 'Stock issue for sent invoice',
          input.userId,
        ],
      );
      await client.query(
        `UPDATE products SET stock_quantity=COALESCE(
          (SELECT SUM(quantity) FROM inventory_stock_levels WHERE company_id=$1 AND product_id=$2),0
         ),updated_at=NOW() WHERE company_id=$1 AND id=$2`,
        [input.companyId, line.product_id],
      );
    }
    if (input.reverse) {
      const originalCost = await client.query<{ cost_total: string | number }>(
        `SELECT COALESCE(SUM(ABS(quantity) * unit_cost),0) AS cost_total
         FROM inventory_stock_movements
         WHERE company_id=$1 AND reference=$2 AND movement_type='issue' AND notes='Stock issue for sent invoice'`,
        [input.companyId, input.invoiceNumber],
      );
      costTotal = Number(originalCost.rows[0]?.cost_total ?? 0);
    }
    return Math.round(costTotal * 100) / 100;
  }

  async rejectPayment(
    user: AuthenticatedUser,
    invoiceId: string,
    paymentId: string,
  ): Promise<InvoiceRow> {
    const membership = await this.membershipFor(user);
    await this.assertBranchInvoiceAccess(membership, invoiceId);
    const payment = await this.db.transaction(async (client) => {
      const result = await client.query<InvoicePaymentRow>(
        `SELECT id, invoice_id, amount, method, reference, paid_at, notes, created_at, status, verified_at, reconciled_at, reconciliation_reference
         FROM invoice_payments WHERE id=$1 AND invoice_id=$2 AND company_id=$3 FOR UPDATE`,
        [paymentId, invoiceId, membership.companyId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('Payment report not found.');
      if (row.status !== 'pending') throw new BadRequestException('Only pending payment reports can be rejected.');
      await client.query(
        "UPDATE invoice_payments SET status='rejected' WHERE id=$1 AND invoice_id=$2 AND company_id=$3 AND status='pending'",
        [paymentId, invoiceId, membership.companyId],
      );
      return row;
    });
    await this.audit.log({
      userId: user.userId, companyId: membership.companyId, branchId: membership.branchId,
      action: 'invoice.payment.reject', entityType: 'invoice_payment', entityId: payment.id,
      oldValues: { status: 'pending' }, newValues: { invoiceId, status: 'rejected' }, ipAddress: null,
    });
    return this.getById(user, invoiceId);
  }

  async reconcilePayment(
    user: AuthenticatedUser,
    invoiceId: string,
    paymentId: string,
    statementReference: string,
  ): Promise<InvoiceRow> {
    const membership = await this.membershipFor(user);
    await this.assertBranchInvoiceAccess(membership, invoiceId);
    const reference = statementReference.trim();
    if (!reference) throw new BadRequestException('Bank statement reference is required.');
    const payment = await this.db.transaction(async (client) => {
      const result = await client.query<InvoicePaymentRow>(
        `SELECT id, invoice_id, amount, method, reference, paid_at, notes, created_at, status, verified_at, reconciled_at, reconciliation_reference
         FROM invoice_payments
         WHERE id=$1 AND invoice_id=$2 AND company_id=$3
         FOR UPDATE`,
        [paymentId, invoiceId, membership.companyId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('Payment record not found.');
      if (row.status !== 'confirmed') {
        throw new BadRequestException('Only confirmed payments can be reconciled.');
      }
      await client.query(
        `UPDATE invoice_payments
         SET status='reconciled', reconciliation_reference=$1, reconciled_at=NOW(), reconciled_by=$2
         WHERE id=$3 AND invoice_id=$4 AND company_id=$5 AND status='confirmed'`,
        [reference, user.userId, paymentId, invoiceId, membership.companyId],
      );
      return row;
    });
    await this.audit.log({
      userId: user.userId, companyId: membership.companyId, branchId: membership.branchId,
      action: 'invoice.payment.reconcile', entityType: 'invoice_payment', entityId: payment.id,
      oldValues: { status: 'confirmed' },
      newValues: { invoiceId, statementReference: reference, status: 'reconciled' },
      ipAddress: null,
    });
    return this.getById(user, invoiceId);
  }

  async updateStatus(user: AuthenticatedUser, invoiceId: string, status: string): Promise<InvoiceRow> {
    const membership = await this.membershipFor(user);
    await this.assertBranchInvoiceAccess(membership, invoiceId);
    await this.accounting.ensureDefaults(membership.companyId);
    if (!this.isInvoiceStatus(status)) throw new BadRequestException('Invalid invoice status.');
    if (status !== 'sent' && status !== 'cancelled') {
      throw new BadRequestException('Only draft invoices can be sent, and unpaid invoices can be cancelled.');
    }

    const previousStatus = await this.db.transaction(async (client) => {
      const existing = await client.query<{
        status: InvoiceStatus;
        customer_id: string;
        invoice_number: string;
        issue_date: string;
        subtotal: string | number;
        tax_amount: string | number;
        total: string | number;
        amount_paid: string | number;
        credited_amount: string | number;
      }>(
        'SELECT status, customer_id, invoice_number, issue_date, subtotal, tax_amount, total, amount_paid, credited_amount FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [invoiceId, membership.companyId],
      );
      const invoice = existing.rows[0];
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.status === 'paid' || invoice.status === 'partially_paid') {
        throw new BadRequestException('Paid invoices cannot be sent again or cancelled.');
      }
      if (status === 'cancelled' && Number(invoice.credited_amount) > 0) {
        throw new BadRequestException('Invoices with issued credit notes cannot be cancelled. Resolve the credit note workflow instead.');
      }
      if (invoice.status === 'cancelled' && status !== 'cancelled') {
        throw new BadRequestException('Cancelled invoices cannot be reopened.');
      }
      if (status === 'sent' && invoice.status !== 'draft' && invoice.status !== 'sent') {
        throw new BadRequestException('Only draft invoices can be sent.');
      }
      if (invoice.status === status) return invoice.status;

      if (status === 'sent' && invoice.status === 'draft') {
        const stockCost = await this.applyInvoiceStock(client, { companyId: membership.companyId, invoiceId, invoiceNumber: invoice.invoice_number, userId: user.userId });
        if (stockCost > 0) {
          await this.postJournal(client, {
            companyId: membership.companyId, date: invoice.issue_date, description: `Cost of goods sold for invoice ${invoice.invoice_number}`,
            sourceType: 'invoice_cogs', sourceId: invoiceId, userId: user.userId,
            lines: [
              { systemCode: 'purchases_expense', debit: stockCost, credit: 0, description: 'Cost of goods sold' },
              { systemCode: 'inventory', debit: 0, credit: stockCost, description: 'Reduce inventory asset' },
            ],
          });
        }
        await this.postJournal(client, {
          companyId: membership.companyId, date: invoice.issue_date, description: `Sales invoice ${invoiceId}`,
          sourceType: 'invoice', sourceId: invoiceId, userId: user.userId,
          lines: [
            { systemCode: 'accounts_receivable', debit: Number(invoice.total), credit: 0, description: 'Customer receivable' },
            { systemCode: 'sales_revenue', debit: 0, credit: Number(invoice.subtotal), description: 'Sales revenue' },
            { systemCode: 'output_tax', debit: 0, credit: Number(invoice.tax_amount), description: 'Output tax payable' },
          ],
        });
        await client.query(
          'UPDATE customers SET outstanding_balance = outstanding_balance + $1, updated_at = NOW() WHERE id = $2 AND company_id = $3',
          [invoice.total, invoice.customer_id, membership.companyId],
        );
      }
      if (status === 'cancelled' && (invoice.status === 'sent' || invoice.status === 'overdue')) {
        const reported = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM invoice_payments WHERE company_id=$1 AND invoice_id=$2 AND status <> 'rejected'",
          [membership.companyId, invoiceId],
        );
        if (Number(reported.rows[0].count) > 0) throw new BadRequestException('Invoices with payment reports cannot be cancelled. Resolve the payment reports first.');
        const stockCost = await this.applyInvoiceStock(client, { companyId: membership.companyId, invoiceId, invoiceNumber: invoice.invoice_number, userId: user.userId, reverse: true });
        if (stockCost > 0) {
          await this.postJournal(client, {
            companyId: membership.companyId, date: null, description: `Reverse cost of goods sold for cancelled invoice ${invoice.invoice_number}`,
            sourceType: 'invoice_cogs_reversal', sourceId: invoiceId, userId: user.userId,
            lines: [
              { systemCode: 'inventory', debit: stockCost, credit: 0, description: 'Restore inventory asset' },
              { systemCode: 'purchases_expense', debit: 0, credit: stockCost, description: 'Reverse cost of goods sold' },
            ],
          });
        }
        await this.postJournal(client, {
          companyId: membership.companyId, date: null, description: `Reversal of cancelled invoice ${invoiceId}`,
          sourceType: 'invoice_cancellation', sourceId: invoiceId, userId: user.userId,
          lines: [
            { systemCode: 'sales_revenue', debit: Number(invoice.subtotal), credit: 0, description: 'Reverse sales revenue' },
            { systemCode: 'output_tax', debit: Number(invoice.tax_amount), credit: 0, description: 'Reverse output tax' },
            { systemCode: 'accounts_receivable', debit: 0, credit: Number(invoice.total), description: 'Reverse customer receivable' },
          ],
        });
        const remaining = Math.max(0, Number(invoice.total) - Number(invoice.amount_paid));
        await client.query(
          'UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1), updated_at = NOW() WHERE id = $2 AND company_id = $3',
          [remaining, invoice.customer_id, membership.companyId],
        );
      }
      await client.query(
        'UPDATE invoices SET status = $1::invoice_status, updated_at = NOW() WHERE id = $2 AND company_id = $3',
        [status, invoiceId, membership.companyId],
      );
      return invoice.status;
    });

    if (previousStatus !== status) {
      await this.audit.log({
        userId: user.userId, companyId: membership.companyId, branchId: membership.branchId,
        action: 'invoice.status.update', entityType: 'invoice', entityId: invoiceId,
        oldValues: { status: previousStatus }, newValues: { status }, ipAddress: null,
      });
    }
    return this.getById(user, invoiceId);
  }

  private isInvoiceStatus(value: string): value is InvoiceStatus {
    return ['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled'].includes(value);
  }
}
