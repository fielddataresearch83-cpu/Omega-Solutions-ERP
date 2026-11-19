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

      if (next === 'processing') {
        if (!warehouseId) throw new BadRequestException('Choose a warehouse before starting order processing.');
        const warehouse = await client.query<{ id: string }>(
          'SELECT id FROM warehouses WHERE id = $1 AND company_id = $2 AND is_active = true FOR SHARE',
          [warehouseId, membership.companyId],
        );
        if (!warehouse.rows[0]) throw new NotFoundException('Active warehouse not found in this company.');

        const items = await client.query<{
          id: string; product_id: string | null; quantity: string | number;
          is_service: boolean | null; is_active: boolean | null; product_name: string;
        }>(
          `SELECT soi.id, soi.product_id, soi.quantity, p.is_service, p.is_active, soi.product_name
           FROM sales_order_items soi
           LEFT JOIN products p ON p.id = soi.product_id AND p.company_id = soi.company_id
           WHERE soi.company_id = $1 AND soi.sales_order_id = $2
           ORDER BY soi.product_id NULLS LAST, soi.id`,
          [membership.companyId, id],
        );
        if (!items.rows.length) throw new BadRequestException('This sales order has no line items to process.');

        // Lock stock rows in a stable product order. Competing orders for the same
        // stock therefore serialize before changing reserved_quantity.
        for (const item of items.rows) {
          if (!item.product_id) continue;
          if (item.is_service === null || item.is_active === null) {
            throw new BadRequestException(`Product for order line "${item.product_name}" no longer exists in this company.`);
          }
          if (item.is_service) continue;
          if (!item.is_active) throw new BadRequestException(`Product "${item.product_name}" is inactive and cannot be reserved.`);

          const quantity = Number(item.quantity);
          const stock = await client.query<{ id: string; quantity: string | number; reserved_quantity: string | number }>(
            'SELECT id, quantity, reserved_quantity FROM inventory_stock_levels WHERE company_id = $1 AND warehouse_id = $2 AND product_id = $3 FOR UPDATE',
            [membership.companyId, warehouseId, item.product_id],
          );
          const row = stock.rows[0];
          const available = row ? Number(row.quantity) - Number(row.reserved_quantity) : 0;
          if (!row || available + 0.0000001 < quantity) {
            throw new BadRequestException(`Insufficient available stock to reserve "${item.product_name}" in the selected warehouse.`);
          }

          await client.query(
            'UPDATE inventory_stock_levels SET reserved_quantity = reserved_quantity + $1, updated_at = NOW() WHERE company_id = $2 AND warehouse_id = $3 AND product_id = $4',
            [quantity, membership.companyId, warehouseId, item.product_id],
          );
          const reservationInsert = await client.query<{ id: string }>(
            `INSERT INTO sales_order_reservations
              (company_id, sales_order_id, sales_order_item_id, product_id, warehouse_id, quantity, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7) RETURNING id`,
            [membership.companyId, id, item.id, item.product_id, warehouseId, quantity, user.userId],
          );

          // Batch tracking is activated only after its additive migration is installed.
          const batchSchema = await client.query<{ present: boolean }>(
            `SELECT to_regclass('public.inventory_batches') IS NOT NULL
              AND to_regclass('public.sales_order_reservation_batch_allocations') IS NOT NULL AS present`,
          );
          if (batchSchema.rows[0]?.present) {
            const lots = await client.query<{ id: string; quantity_on_hand: string | number; reserved_quantity: string | number }>(
              `SELECT id, quantity_on_hand, reserved_quantity FROM inventory_batches
               WHERE company_id = $1 AND product_id = $2 AND warehouse_id = $3
                 AND status = 'available' AND quality_status = 'released'
                 AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)
                 AND quantity_on_hand > reserved_quantity
               ORDER BY expires_on ASC NULLS LAST, created_at ASC, id ASC FOR UPDATE`,
              [membership.companyId, item.product_id, warehouseId],
            );
            let remaining = quantity;
            for (const lot of lots.rows) {
              if (remaining <= 0.0000001) break;
              const allocatable = Math.max(0, Number(lot.quantity_on_hand) - Number(lot.reserved_quantity));
              const allocated = Math.min(remaining, allocatable);
              if (allocated <= 0) continue;
              await client.query(
                `UPDATE inventory_batches SET reserved_quantity = reserved_quantity + $1, updated_at = NOW()
                 WHERE company_id = $2 AND id = $3`,
                [allocated, membership.companyId, lot.id],
              );
              await client.query(
                `INSERT INTO sales_order_reservation_batch_allocations
                  (company_id, reservation_id, batch_id, product_id, warehouse_id, quantity)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [membership.companyId, reservationInsert.rows[0].id, lot.id, item.product_id, warehouseId, allocated],
              );
              remaining -= allocated;
            }
            if (remaining > 0.0000001) {
              throw new BadRequestException(`Released, unexpired batches cannot cover the reservation for "${item.product_name}".`);
            }
          }
        }
      }

      if (next === 'cancelled' && from === 'processing') {
        const reservations = await client.query<{
          id: string; product_id: string; warehouse_id: string; quantity: string | number;
        }>(
          `SELECT id, product_id, warehouse_id, quantity
           FROM sales_order_reservations
           WHERE company_id = $1 AND sales_order_id = $2 AND status = 'reserved'
           ORDER BY warehouse_id, product_id, sales_order_item_id
           FOR UPDATE`,
          [membership.companyId, id],
        );
        for (const reservation of reservations.rows) {
          const batchSchema = await client.query<{ present: boolean }>(
            `SELECT to_regclass('public.sales_order_reservation_batch_allocations') IS NOT NULL AS present`,
          );
          if (batchSchema.rows[0]?.present) {
            const allocations = await client.query<{ batch_id: string; quantity: string | number }>(
              `SELECT batch_id, quantity FROM sales_order_reservation_batch_allocations
               WHERE company_id = $1 AND reservation_id = $2 AND status = 'reserved' FOR UPDATE`,
              [membership.companyId, reservation.id],
            );
            for (const allocation of allocations.rows) {
              const batchRelease = await client.query<{ id: string }>(
                `UPDATE inventory_batches SET reserved_quantity = reserved_quantity - $1, updated_at = NOW()
                 WHERE company_id = $2 AND id = $3 AND reserved_quantity >= $1 RETURNING id`,
                [Number(allocation.quantity), membership.companyId, allocation.batch_id],
              );
              if (!batchRelease.rows[0]) throw new BadRequestException('The batch reservation ledger is inconsistent; cancellation was rolled back.');
            }
            await client.query(
              `UPDATE sales_order_reservation_batch_allocations SET status = 'released', updated_at = NOW()
               WHERE company_id = $1 AND reservation_id = $2 AND status = 'reserved'`,
              [membership.companyId, reservation.id],
            );
          }
          const released = await client.query<{ id: string }>(
            `UPDATE inventory_stock_levels
             SET reserved_quantity = reserved_quantity - $1, updated_at = NOW()
             WHERE company_id = $2 AND warehouse_id = $3 AND product_id = $4
               AND reserved_quantity >= $1
             RETURNING id`,
            [Number(reservation.quantity), membership.companyId, reservation.warehouse_id, reservation.product_id],
          );
          if (!released.rows[0]) {
            throw new BadRequestException('The stock reservation ledger is inconsistent; cancellation was rolled back.');
          }
          await client.query(
            `UPDATE sales_order_reservations
             SET status = 'released', released_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND company_id = $2 AND status = 'reserved'`,
            [reservation.id, membership.companyId],
          );
        }
      }

      if (next === 'fulfilled') {
        if (!warehouseId) throw new BadRequestException('Choose a warehouse before fulfilling this order.');
        const warehouse = await client.query<{ id: string }>(
          'SELECT id FROM warehouses WHERE id = $1 AND company_id = $2 AND is_active = true FOR SHARE',
          [warehouseId, membership.companyId],
        );
        if (!warehouse.rows[0]) throw new NotFoundException('Active warehouse not found in this company.');

        const items = await client.query<{
          id: string; product_id: string | null; quantity: string | number; is_service: boolean | null;
          is_active: boolean | null; cost_price: string | number | null; product_name: string;
        }>(
          `SELECT soi.id, soi.product_id, soi.quantity, p.is_service, p.is_active, p.cost_price, soi.product_name
           FROM sales_order_items soi
           LEFT JOIN products p ON p.id = soi.product_id AND p.company_id = soi.company_id
           WHERE soi.company_id = $1 AND soi.sales_order_id = $2
           ORDER BY soi.product_id NULLS LAST, soi.id`,
          [membership.companyId, id],
        );
        if (!items.rows.length) throw new BadRequestException('This sales order has no line items to fulfil.');

        const reservationResult = await client.query<{
          id: string; sales_order_item_id: string; product_id: string; warehouse_id: string; quantity: string | number;
        }>(
          `SELECT id, sales_order_item_id, product_id, warehouse_id, quantity
           FROM sales_order_reservations
           WHERE company_id = $1 AND sales_order_id = $2 AND status = 'reserved'
           ORDER BY warehouse_id, product_id, sales_order_item_id
           FOR UPDATE`,
          [membership.companyId, id],
        );
        const reservationsByLine = new Map(reservationResult.rows.map(row => [row.sales_order_item_id, row]));

        for (const item of items.rows) {
          if (!item.product_id) continue;
          if (item.is_service === null || item.is_active === null) {
            throw new BadRequestException(`Product for order line "${item.product_name}" no longer exists in this company.`);
          }
          if (item.is_service) continue;
          if (!item.is_active) throw new BadRequestException(`Product "${item.product_name}" is inactive and cannot be fulfilled.`);

          const quantity = Number(item.quantity);
          const reservation = reservationsByLine.get(item.id);
          if (reservation && reservation.warehouse_id !== warehouseId) {
            throw new BadRequestException('Fulfil this order from the warehouse where its stock was reserved.');
          }
          if (reservation && Math.abs(Number(reservation.quantity) - quantity) > 0.0000001) {
            throw new BadRequestException('The order quantity no longer matches its stock reservation.');
          }

          const stock = await client.query<{
            quantity: string | number; reserved_quantity: string | number; average_unit_cost: string | number;
          }>(
            'SELECT quantity, reserved_quantity, average_unit_cost FROM inventory_stock_levels WHERE company_id = $1 AND warehouse_id = $2 AND product_id = $3 FOR UPDATE',
            [membership.companyId, warehouseId, item.product_id],
          );
          const stockRow = stock.rows[0];
          if (!stockRow) throw new BadRequestException(`Stock for "${item.product_name}" is no longer available in the selected warehouse.`);
          const reservedQuantity = reservation ? quantity : 0;
          if (Number(stockRow.quantity) + 0.0000001 < quantity ||
              Number(stockRow.reserved_quantity) + 0.0000001 < reservedQuantity) {
            throw new BadRequestException(`The reserved stock for "${item.product_name}" is no longer available.`);
          }
          if (!reservation && Number(stockRow.quantity) - Number(stockRow.reserved_quantity) + 0.0000001 < quantity) {
            throw new BadRequestException(`Insufficient available stock for "${item.product_name}" in the selected warehouse.`);
          }

          let issueCost = Number(stockRow.average_unit_cost ?? item.cost_price ?? 0);
          const updated = await client.query<{ id: string }>(
            `UPDATE inventory_stock_levels
             SET quantity = quantity - $1,
                 reserved_quantity = reserved_quantity - $2,
                 updated_at = NOW()
             WHERE company_id = $3 AND warehouse_id = $4 AND product_id = $5
               AND quantity >= $1 AND reserved_quantity >= $2
             RETURNING id`,
            [quantity, reservedQuantity, membership.companyId, warehouseId, item.product_id],
          );
          if (!updated.rows[0]) throw new BadRequestException('Stock changed during fulfilment; retry the operation.');

          if (reservation) {
            await client.query(
              `UPDATE sales_order_reservations
               SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
               WHERE id = $1 AND company_id = $2 AND status = 'reserved'`,
              [reservation.id, membership.companyId],
            );
          }

          const movement = await client.query<{ id: string }>(
            `INSERT INTO inventory_stock_movements
              (company_id, product_id, warehouse_id, movement_type, quantity, unit_cost, reference, notes, created_by)
             VALUES ($1, $2, $3, 'issue', $4, $5, $6, $7, $8) RETURNING id`,
            [membership.companyId, item.product_id, warehouseId, -quantity, issueCost, order.order_number, `Sales order fulfilment ${order.order_number}`, user.userId],
          );

          const batchSchema = await client.query<{ present: boolean }>(
            `SELECT to_regclass('public.inventory_batches') IS NOT NULL
               AND to_regclass('public.inventory_stock_movement_allocations') IS NOT NULL
               AND to_regclass('public.sales_order_reservation_batch_allocations') IS NOT NULL AS present`,
          );
          if (batchSchema.rows[0]?.present) {
            const lots = await client.query<{
              id: string; quantity_on_hand: string | number; reserved_quantity: string | number;
              reservation_quantity: string | number; allocation_id: string | null; unit_cost: string | number;
            }>(
              `SELECT b.id, b.quantity_on_hand, b.reserved_quantity, b.unit_cost,
                      a.quantity AS reservation_quantity, a.id AS allocation_id
               FROM inventory_batches b
               LEFT JOIN sales_order_reservation_batch_allocations a
                 ON a.company_id = b.company_id AND a.batch_id = b.id
                AND a.reservation_id = $4 AND a.status = 'reserved'
               WHERE b.company_id = $1 AND b.product_id = $2 AND b.warehouse_id = $3
                 AND b.quality_status = 'released' AND b.status = 'available'
                 AND (b.expires_on IS NULL OR b.expires_on >= CURRENT_DATE)
                 AND CASE WHEN $5::boolean
                   THEN COALESCE(a.quantity, 0)
                   ELSE b.quantity_on_hand - b.reserved_quantity END > 0
               ORDER BY b.expires_on ASC NULLS LAST, b.created_at, b.id
               FOR UPDATE OF b`,
              [membership.companyId, item.product_id, warehouseId, reservation?.id ?? null, Boolean(reservation)],
            );
            let remaining = quantity;
            let batchCost = 0;
            for (const lot of lots.rows) {
              const take = Math.min(
                remaining,
                reservation
                  ? Number(lot.reservation_quantity ?? lot.reserved_quantity)
                  : Number(lot.quantity_on_hand) - Number(lot.reserved_quantity),
              );
              if (take <= 0) continue;
              const changed = await client.query(
                `UPDATE inventory_batches SET quantity_on_hand = quantity_on_hand - $1,
                   reserved_quantity = reserved_quantity - $4,
                   status = CASE WHEN quantity_on_hand - $1 <= 0.00005 THEN 'depleted' ELSE status END,
                   updated_at = NOW()
                 WHERE company_id = $2 AND id = $3
                   AND quantity_on_hand >= $1 AND reserved_quantity >= $4
                   AND quantity_on_hand - reserved_quantity >= $1 - $4`,
                [take, membership.companyId, lot.id, reservation ? take : 0],
              );
              if ((changed.rowCount ?? 0) !== 1) {
                throw new BadRequestException(`Batch stock changed for "${item.product_name}"; retry fulfilment.`);
              }
              await client.query(
                `INSERT INTO inventory_stock_movement_allocations
                  (company_id, movement_id, batch_id, product_id, warehouse_id, quantity, unit_cost)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [membership.companyId, movement.rows[0].id, lot.id, item.product_id, warehouseId, take, lot.unit_cost],
              );
              if (reservation) {
                const allocationTable = await client.query<{ present: boolean }>(
                  `SELECT to_regclass('public.sales_order_reservation_batch_allocations') IS NOT NULL AS present`,
                );
                if (allocationTable.rows[0]?.present) {
                  await client.query(
                    `UPDATE sales_order_reservation_batch_allocations
                     SET status = 'consumed', updated_at = NOW()
                     WHERE company_id = $1 AND reservation_id = $2 AND batch_id = $3 AND status = 'reserved'`,
                    [membership.companyId, reservation.id, lot.id],
                  );
                }
              }
              batchCost += take * Number(lot.unit_cost);
              remaining -= take;
              if (remaining <= 0.0000001) break;
            }
            if (remaining > 0.0000001) {
              throw new BadRequestException(
                reservation
                  ? `The reservation for "${item.product_name}" has no complete batch allocation. Cancel and re-reserve this order after batch traceability is enabled.`
                  : `Released, unexpired batch stock cannot cover "${item.product_name}" for fulfilment.`,
              );
            }
            issueCost = batchCost / quantity;
            await client.query(
              `UPDATE inventory_stock_movements SET unit_cost = $1
               WHERE id = $2 AND company_id = $3`,
              [issueCost, movement.rows[0].id, membership.companyId],
            );
            costOfGoods += quantity * issueCost;
          } else {
            costOfGoods += quantity * issueCost;
          }
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
      action: transition.to === 'fulfilled' ? 'sales_order.fulfilled' : transition.to === 'processing' ? 'sales_order.stock_reserved' : transition.to === 'cancelled' ? 'sales_order.cancelled' : 'sales_order.status.update',
      entityType: 'sales_order', entityId: id,
      oldValues: { status: fromStatus },
      newValues: { status: transition.to, ...(warehouseId ? { warehouseId } : {}) },
      ipAddress: null,
    });
    return this.getById(user, id);
  }

  private isStatus(value: string): value is SalesOrderStatus {
    return ['confirmed', 'processing', 'fulfilled', 'cancelled'].includes(value);
  }
}
