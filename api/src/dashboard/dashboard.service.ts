import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

type DashboardModule = { code: string; enabled: boolean };

@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async summary(user: AuthenticatedUser) {
    if (!user.companyId) throw new ForbiddenException('Select a company before viewing dashboard metrics.');
    const membership = await this.memberships.getMembershipForCompany(user.userId, user.companyId);
    const catalogue = await this.subscriptions.getModuleCatalogue(membership.companyId);
    const enabled = new Map((catalogue.modules as DashboardModule[]).map((module) => [module.code, module.enabled]));
    const permissions = new Set(user.permissions ?? []);
    const can = (module: string, permission: string) => enabled.get(module) === true && permissions.has(permission);
    const company = await this.db.query<{ currency: string | null }>(
      'SELECT currency FROM companies WHERE id = $1',
      [membership.companyId],
    );
    const currency = company.rows[0]?.currency || 'KES';

    const result = {
      currency,
      customers: null as null | { count: number; receivables: number | null },
      suppliers: null as null | { count: number; payables: number },
      inventory: null as null | { activeProducts: number; lowStock: number; costValue: number; lowStockProducts: Array<{ id: string; name: string; sku: string; stock_quantity: number; reorder_level: number }> },
      invoiceTrend: null as null | Array<{ key: string; total: number }>,
      overdueInvoices: null as null | Array<{ id: string; invoice_number: string; customer_name: string; due_date: string; currency: string; balance: number }>,
    };

    if (can('sales', 'customers:read')) {
      const customers = await this.db.query<{ count: number; receivables: string | number }>(
        'SELECT COUNT(*)::int AS count, COALESCE(SUM(outstanding_balance), 0) AS receivables FROM customers WHERE company_id = $1',
        [membership.companyId],
      );
      result.customers = {
        count: Number(customers.rows[0]?.count ?? 0),
        // Customer balances are company-wide financial data and are hidden from branch-bound users.
        receivables: membership.branchId ? null : Number(customers.rows[0]?.receivables ?? 0),
      };
    }

    if (can('procurement', 'suppliers:read') && !membership.branchId) {
      const suppliers = await this.db.query<{ count: number; payables: string | number }>(
        'SELECT COUNT(*)::int AS count, COALESCE(SUM(outstanding_balance), 0) AS payables FROM suppliers WHERE company_id = $1',
        [membership.companyId],
      );
      result.suppliers = {
        count: Number(suppliers.rows[0]?.count ?? 0),
        payables: Number(suppliers.rows[0]?.payables ?? 0),
      };
    }

    if (can('inventory', 'products:read')) {
      const inventory = await this.db.query<{ active_products: number; low_stock: number; cost_value: string | number }>(
        `SELECT
           COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_products,
           COUNT(*) FILTER (WHERE is_active = TRUE AND is_service = FALSE AND stock_quantity <= reorder_level)::int AS low_stock,
           COALESCE(SUM(cost_price * stock_quantity) FILTER (WHERE is_active = TRUE), 0) AS cost_value
         FROM products WHERE company_id = $1`,
        [membership.companyId],
      );
      const lowStockProducts = await this.db.query<{ id: string; name: string; sku: string; stock_quantity: number; reorder_level: number }>(
        `SELECT id, name, sku, stock_quantity, reorder_level
         FROM products
         WHERE company_id = $1 AND is_active = TRUE AND is_service = FALSE
           AND stock_quantity <= reorder_level
         ORDER BY (reorder_level - stock_quantity) DESC, name ASC
         LIMIT 8`,
        [membership.companyId],
      );
      result.inventory = {
        activeProducts: Number(inventory.rows[0]?.active_products ?? 0),
        lowStock: Number(inventory.rows[0]?.low_stock ?? 0),
        costValue: Number(inventory.rows[0]?.cost_value ?? 0),
        lowStockProducts: lowStockProducts.rows.map((row) => ({
          ...row,
          stock_quantity: Number(row.stock_quantity),
          reorder_level: Number(row.reorder_level),
        })),
      };
    }

    if (can('sales', 'sales:read')) {
      const trendParams: (string | null)[] = [membership.companyId, currency, membership.branchId ?? null];
      const branchFilter = `AND ($3::uuid IS NULL OR EXISTS (
        SELECT 1 FROM pos_sales ps
        JOIN pos_registers pr ON pr.id = ps.register_id AND pr.company_id = ps.company_id
        WHERE ps.company_id = i.company_id AND ps.invoice_id = i.id AND pr.branch_id = $3::uuid
      ))`;
      const trend = await this.db.query<{ key: string; total: string | number }>(
        `SELECT TO_CHAR(DATE_TRUNC('month', i.issue_date), 'YYYY-MM') AS key,
                COALESCE(SUM(i.total), 0) AS total
         FROM invoices i
         WHERE i.company_id = $1 AND i.currency = $2
           AND i.status NOT IN ('draft', 'cancelled')
           AND i.issue_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
           AND i.issue_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
           ${branchFilter}
         GROUP BY DATE_TRUNC('month', i.issue_date)
         ORDER BY DATE_TRUNC('month', i.issue_date)`,
        trendParams,
      );
      result.invoiceTrend = trend.rows.map((row) => ({ key: row.key, total: Number(row.total) }));

      const overdue = await this.db.query<{
        id: string; invoice_number: string; customer_name: string; due_date: string; currency: string; balance: string | number;
      }>(
        `SELECT i.id, i.invoice_number, c.name AS customer_name, i.due_date, i.currency,
                GREATEST(i.total - i.amount_paid - COALESCE(i.credited_amount, 0), 0) AS balance
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id
         WHERE i.company_id = $1 AND i.status NOT IN ('draft', 'cancelled', 'paid')
           AND i.due_date < CURRENT_DATE
           AND GREATEST(i.total - i.amount_paid - COALESCE(i.credited_amount, 0), 0) > 0
           ${branchFilter}
         ORDER BY i.due_date ASC
         LIMIT 6`,
        trendParams,
      );
      result.overdueInvoices = overdue.rows.map((row) => ({ ...row, balance: Number(row.balance) }));
    }

    return result;
  }
}
