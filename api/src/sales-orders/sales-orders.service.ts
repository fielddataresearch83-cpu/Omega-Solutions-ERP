import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { SalesOrderItemRow, SalesOrderRow, SalesOrderStatus } from './sales-order.types.js';

const SELECT_ORDERS = `
  SELECT so.id, so.company_id, so.customer_id, c.name AS customer_name,
         so.source_quotation_id, q.quotation_number AS source_quotation_number,
         so.order_number, so.order_date, so.status, so.currency, so.subtotal,
         so.tax_amount, so.total, so.notes, so.created_at, so.updated_at,
         COUNT(soi.id)::int AS item_count
  FROM sales_orders so
  JOIN customers c ON c.id = so.customer_id AND c.company_id = so.company_id
  LEFT JOIN quotations q ON q.id = so.source_quotation_id AND q.company_id = so.company_id
  LEFT JOIN sales_order_items soi ON soi.sales_order_id = so.id AND soi.company_id = so.company_id
`;

@Injectable()
export class SalesOrdersService {
  constructor(private readonly db: DatabaseService, private readonly memberships: MembershipsService, private readonly audit: AuditService, private readonly accounting: AccountingService) {}

  private async membershipFor(user: AuthenticatedUser) {
    return user.companyId
      ? this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : this.memberships.getMembership(user.userId);
  }

  private assertCompanyWideAccess(membership: { branchId?: string | null }): void {
    if (membership.branchId) {
      throw new ForbiddenException('Sales orders are company-wide records and can only be accessed by company-wide members.');
    }
  }

  async list(user: AuthenticatedUser): Promise<SalesOrderRow[]> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWideAccess(membership);
    const result = await this.db.query<SalesOrderRow>(
      `${SELECT_ORDERS} WHERE so.company_id = $1 GROUP BY so.id, c.name, q.quotation_number ORDER BY so.created_at DESC`,
      [membership.companyId],
    );
    return result.rows;
  }

  async getById(user: AuthenticatedUser, id: string): Promise<SalesOrderRow> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWideAccess(membership);
    const result = await this.db.query<SalesOrderRow>(
      `${SELECT_ORDERS} WHERE so.company_id = $1 AND so.id = $2 GROUP BY so.id, c.name, q.quotation_number`,
      [membership.companyId, id],
    );
    const order = result.rows[0];
    if (!order) throw new NotFoundException('Sales order not found.');
    const items = await this.db.query<SalesOrderItemRow>(
      `SELECT id, sales_order_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_subtotal, tax_amount, line_total
       FROM sales_order_items WHERE company_id = $1 AND sales_order_id = $2 ORDER BY created_at`,
      [membership.companyId, id],
    );
    order.items = items.rows;
    return order;
  }

  async createFromQuotation(user: AuthenticatedUser, quotationId: string): Promise<SalesOrderRow> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWideAccess(membership);
    let createdNewOrder = false;
    const orderId = await this.db.transaction(async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT id, company_id, customer_id, quotation_number, issue_date, EXTRACT(YEAR FROM issue_date)::int AS issue_year, status, currency, subtotal, tax_amount, total, notes
         FROM quotations WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [quotationId, membership.companyId],
      );
      const quote = result.rows[0];
      if (!quote) throw new NotFoundException('Quotation not found.');
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM sales_orders WHERE source_quotation_id = $1 AND company_id = $2',
        [quotationId, membership.companyId],
      );
      if (existing.rows[0]) return existing.rows[0].id;
      if (quote.status !== 'accepted') throw new BadRequestException('Only accepted quotations can be converted to a sales order.');

      const year = Number(quote.issue_year);
      const seq = await client.query<{ next_number: number }>(
        `INSERT INTO sales_order_sequences (company_id, order_year, next_number) VALUES ($1, $2, 1)
         ON CONFLICT (company_id, order_year) DO UPDATE SET next_number = sales_order_sequences.next_number + 1 RETURNING next_number`,
        [membership.companyId, year],
      );
      const orderNumber = `SO-${year}-${String(seq.rows[0].next_number).padStart(5, '0')}`;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sales_orders (company_id, customer_id, source_quotation_id, order_number, order_date, status, currency, subtotal, tax_amount, total, notes, created_by)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, 'confirmed', $5, $6, $7, $8, $9, $10) RETURNING id`,
        [membership.companyId, quote.customer_id, quotationId, orderNumber, quote.currency, quote.subtotal, quote.tax_amount, quote.total, quote.notes, user.userId],
      );
      await client.query(
        `INSERT INTO sales_order_items (company_id, sales_order_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_subtotal, tax_amount, line_total)
         SELECT company_id, $1, product_id, product_name, sku, quantity, unit_price, tax_rate, line_subtotal, tax_amount, line_total
         FROM quotation_items WHERE company_id = $2 AND quotation_id = $3`,
        [inserted.rows[0].id, membership.companyId, quotationId],
      );
      await client.query(
        "UPDATE quotations SET status = 'converted', updated_at = NOW() WHERE id = $1 AND company_id = $2",
        [quotationId, membership.companyId],
      );
      createdNewOrder = true;
      return inserted.rows[0].id;
    });
    if (createdNewOrder) {
      await this.audit.log({
        userId: user.userId, companyId: membership.companyId, branchId: null,
        action: 'sales_order.create_from_quotation', entityType: 'sales_order', entityId: orderId,
        oldValues: null, newValues: { quotationId }, ipAddress: null,
      });
    }
    return this.getById(user, orderId);
  }

  async updateStatus(user: AuthenticatedUser, id: string, next: string, warehouseId?: string): Promise<SalesOrderRow> {
    const membership = await this.membershipFor(user);
    this.assertCompanyWideAccess(membership);
    let fromStatus: SalesOrderStatus = 'confirmed';
    let costOfGoods = 0;
    const transition = await this.db.transaction(async (client) => {
      const current = await client.query<{ id: string; status: string; order_number: string }>(
        'SELECT id, status, order_number FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [id, membership.companyId],
      );
      const order = current.rows[0];
      if (!order) throw new NotFoundException('Sales order not found.');
      const transitions: Record<SalesOrderStatus, SalesOrderStatus[]> = {
        confirmed: ['processing', 'cancelled'],
        processing: ['fulfilled', 'cancelled'],
        fulfilled: [],
        cancelled: [],
      };
      const from = order.status as SalesOrderStatus;
      fromStatus = from;
      if (!this.isStatus(next) || !transitions[from]?.includes(next as SalesOrderStatus)) {
        throw new BadRequestException(`Cannot change sales order status from ${from} to ${next}.`);
      }

      if (next === 'fulfilled') {
        if (!warehouseId) throw new BadRequestException('Choose a warehouse before fulfilling this order.');
        const warehouse = await client.query<{ id: string }>(
          'SELECT id FROM warehouses WHERE id = $1 AND company_id = $2 AND is_active = true FOR SHARE',
          [warehouseId, membership.companyId],
        );
        if (!warehouse.rows[0]) throw new NotFoundException('Active warehouse not found in this company.');
        const items = await client.query<{
          product_id: string | null; quantity: string | number; is_service: boolean | null;
          is_active: boolean | null; cost_price: string | number | null; product_name: string;
        }>(
          `SELECT soi.product_id, soi.quantity, p.is_service, p.is_active, p.cost_price, soi.product_name
           FROM sales_order_items soi
           LEFT JOIN products p ON p.id = soi.product_id AND p.company_id = soi.company_id
           WHERE soi.company_id = $1 AND soi.sales_order_id = $2
           ORDER BY soi.created_at, soi.id`,
          [membership.companyId, id],
        );
        if (!items.rows.length) throw new BadRequestException('This sales order has no line items to fulfil.');
        for (const item of items.rows) {
          if (!item.product_id) continue;
          if (item.is_service === null || item.is_active === null) {
            throw new BadRequestException(`Product for order line "${item.product_name}" no longer exists in this company.`);
          }
          if (item.is_service) continue;
          if (!item.is_active) throw new BadRequestException(`Product "${item.product_name}" is inactive and cannot be fulfilled.`);

          const stock = await client.query<{ quantity: string | number; reserved_quantity: string | number; average_unit_cost: string | number }>(
            'SELECT quantity, reserved_quantity, average_unit_cost FROM inventory_stock_levels WHERE company_id = $1 AND warehouse_id = $2 AND product_id = $3 FOR UPDATE',
            [membership.companyId, warehouseId, item.product_id],
          );
          const available = stock.rows[0] ? Number(stock.rows[0].quantity) - Number(stock.rows[0].reserved_quantity) : 0;
          const quantity = Number(item.quantity);
          if (!stock.rows[0] || available + 0.0000001 < quantity) {
            throw new BadRequestException(`Insufficient available stock for "${item.product_name}" in the selected warehouse.`);
          }
          const issueCost = Number(stock.rows[0].average_unit_cost ?? item.cost_price ?? 0);
          costOfGoods += quantity * issueCost;
          await client.query(
            'UPDATE inventory_stock_levels SET quantity = quantity - $1, updated_at = NOW() WHERE company_id = $2 AND warehouse_id = $3 AND product_id = $4',
            [quantity, membership.companyId, warehouseId, item.product_id],
          );
          await client.query(
            `INSERT INTO inventory_stock_movements
              (company_id, product_id, warehouse_id, movement_type, quantity, unit_cost, reference, notes, created_by)
             VALUES ($1, $2, $3, 'issue', $4, $5, $6, $7, $8)`,
            [membership.companyId, item.product_id, warehouseId, -quantity, issueCost, order.order_number, `Sales order fulfilment ${order.order_number}`, user.userId],
          );
          await client.query(
            `UPDATE products SET stock_quantity = COALESCE(
               (SELECT SUM(quantity) FROM inventory_stock_levels WHERE company_id = $1 AND product_id = $2), 0
             ), updated_at = NOW() WHERE company_id = $1 AND id = $2`,
            [membership.companyId, item.product_id],
          );
        }
      }

      if (next === 'fulfilled' && costOfGoods > 0) {
        await this.accounting.ensureDefaults(membership.companyId, client);
        const year = new Date().getFullYear();
        const seq = await client.query<{ next_number: number }>(
          `INSERT INTO journal_entry_sequences(company_id,entry_year,next_number)
           VALUES($1,$2,1)
           ON CONFLICT(company_id,entry_year) DO UPDATE
           SET next_number=journal_entry_sequences.next_number+1
           RETURNING next_number`,
          [membership.companyId, year],
        );
        const entryNumber = `JE-${year}-${String(seq.rows[0].next_number).padStart(6, '0')}`;
        const entry = await client.query<{ id: string }>(
          `INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
           VALUES($1,$2,CURRENT_DATE,$3,'sales_order_cogs',$4,'posted',NOW(),$5) RETURNING id`,
          [membership.companyId, entryNumber, `Cost of goods sold for ${order.order_number}`, id, user.userId],
        );
        const accounts = await client.query<{ id: string; system_code: string }>(
          `SELECT id,system_code FROM chart_of_accounts
           WHERE company_id=$1 AND system_code IN ('inventory','purchases_expense') AND is_active=true`,
          [membership.companyId],
        );
        const inventory = accounts.rows.find(account => account.system_code === 'inventory');
        const cogs = accounts.rows.find(account => account.system_code === 'purchases_expense');
        if (!inventory || !cogs) throw new BadRequestException('Inventory and cost-of-goods accounts must be active.');
        await client.query(
          `INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit)
           VALUES($1,$2,$3,'Cost of goods sold',$4,0),($1,$2,$5,'Inventory relieved on sale',0,$4)`,
          [membership.companyId, entry.rows[0].id, cogs.id, Math.round(costOfGoods * 100) / 100, inventory.id],
        );
      }

      await client.query(
        'UPDATE sales_orders SET status = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3',
        [next, id, membership.companyId],
      );
      return { from, to: next as SalesOrderStatus };
    });

    await this.audit.log({
      userId: user.userId, companyId: membership.companyId, branchId: null,
      action: transition.to === 'fulfilled' ? 'sales_order.fulfilled' : 'sales_order.status.update',
      entityType: 'sales_order', entityId: id,
      oldValues: { status: fromStatus },
      newValues: { status: transition.to, ...(transition.to === 'fulfilled' ? { warehouseId } : {}) },
      ipAddress: null,
    });
    return this.getById(user, id);
  }

  private isStatus(value: string): value is SalesOrderStatus {
    return ['confirmed', 'processing', 'fulfilled', 'cancelled'].includes(value);
  }
}
