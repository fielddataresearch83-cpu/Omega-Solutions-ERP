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
      sales: null as null | {
        currentPeriodInvoiced: number;
        previousPeriodInvoiced: number;
        currentPeriodCollected: number;
        previousPeriodCollected: number;
        creditNotesCurrentPeriod: number | null;
        periodStart: string;
        periodEnd: string;
        previousPeriodStart: string;
        previousPeriodEnd: string;
      },
      expenses: null as null | { currentPeriod: number; previousPeriod: number; periodStart: string; periodEnd: string; previousPeriodStart: string; previousPeriodEnd: string },
      topProducts: null as null | Array<{ id: string; name: string; sku: string; quantity: number; revenue: number }>,
      categoryBreakdown: null as null | Array<{ category: string; revenue: number }>,
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

    // Product stock_quantity is a company-level aggregate, not a branch ledger.
    // Until stock is calculated from branch-scoped movements, suppress inventory summaries
    // for branch-bound users rather than exposing company-wide figures.
    if (can('inventory', 'products:read') && !membership.branchId) {
      const inventory = await this.db.query<{ active_products: number; low_stock: number; cost_value: string | number }>(
        `SELECT
           COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_products,
           COUNT(*) FILTER (WHERE is_active = TRUE AND is_service = FALSE AND stock_quantity <= reorder_level)::int AS low_stock,
           COALESCE((
             SELECT SUM(ROUND(s.quantity * s.average_unit_cost, 2))
             FROM inventory_stock_levels s
             JOIN products valued_product
               ON valued_product.id = s.product_id AND valued_product.company_id = s.company_id
             WHERE s.company_id = $1 AND valued_product.is_service = FALSE
           ), 0) AS cost_value
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
         WHERE i.company_id = $1 AND i.currency = $2::text
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
         WHERE i.company_id = $1 AND i.currency = $2::text AND i.status NOT IN ('draft', 'cancelled', 'paid')
           AND i.due_date < CURRENT_DATE
           AND GREATEST(i.total - i.amount_paid - COALESCE(i.credited_amount, 0), 0) > 0
           ${branchFilter}
         ORDER BY i.due_date ASC
         LIMIT 6`,
        trendParams,
      );
      result.overdueInvoices = overdue.rows.map((row) => ({ ...row, balance: Number(row.balance) }));

      // --- Sales revenue for current and previous calendar month ---
      // Invoiced sales = SUM(invoice total) for non-draft/non-cancelled invoices.
      // Credit notes reduce revenue. Collected payments = confirmed/reconciled invoice_payments.
      // All scoped by company, currency, and branch (via the same branchFilter).
      const periodStart = new Date();
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      const previousPeriodStart = new Date(periodStart);
      previousPeriodStart.setMonth(previousPeriodStart.getMonth() - 1);
      const previousPeriodEnd = new Date(periodStart);

      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const salesParams = [membership.companyId, currency, membership.branchId ?? null];

      const currentInvoiced = await this.db.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(i.total), 0) AS total
         FROM invoices i
         WHERE i.company_id = $1 AND i.currency = $2::text
           AND i.status NOT IN ('draft', 'cancelled')
           AND i.issue_date >= $4::date AND i.issue_date < $5::date
           ${branchFilter}`,
        [...salesParams, fmt(periodStart), fmt(periodEnd)],
      );
      const previousInvoiced = await this.db.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(i.total), 0) AS total
         FROM invoices i
         WHERE i.company_id = $1 AND i.currency = $2::text
           AND i.status NOT IN ('draft', 'cancelled')
           AND i.issue_date >= $4::date AND i.issue_date < $5::date
           ${branchFilter}`,
        [...salesParams, fmt(previousPeriodStart), fmt(previousPeriodEnd)],
      );

      const currentCollected = await this.db.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(ip.amount), 0) AS total
         FROM invoice_payments ip
         JOIN invoices i ON i.id = ip.invoice_id AND i.company_id = ip.company_id
         WHERE ip.company_id = $1 AND i.currency = $2::text
           AND ip.status IN ('confirmed', 'reconciled')
           AND ip.paid_at >= $4::timestamptz AND ip.paid_at < $5::timestamptz
           ${branchFilter.replace('ps.invoice_id = i.id', 'ps.invoice_id = ip.invoice_id')}`,
        [...salesParams, periodStart.toISOString(), periodEnd.toISOString()],
      );
      const previousCollected = await this.db.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(ip.amount), 0) AS total
         FROM invoice_payments ip
         JOIN invoices i ON i.id = ip.invoice_id AND i.company_id = ip.company_id
         WHERE ip.company_id = $1 AND i.currency = $2::text
           AND ip.status IN ('confirmed', 'reconciled')
           AND ip.paid_at >= $4::timestamptz AND ip.paid_at < $5::timestamptz
           ${branchFilter.replace('ps.invoice_id = i.id', 'ps.invoice_id = ip.invoice_id')}`,
        [...salesParams, previousPeriodStart.toISOString(), previousPeriodEnd.toISOString()],
      );

      // Credit notes have no branch_id column — only query for company-wide users
      // to avoid leaking company-wide totals to branch-bound users.
      const creditNotesTotal = !membership.branchId
        ? await this.db.query<{ total: string | number }>(
            `SELECT COALESCE(SUM(cn.total), 0) AS total
             FROM credit_notes cn
             WHERE cn.company_id = $1
               AND cn.issue_date >= $2::date AND cn.issue_date < $3::date`,
            [membership.companyId, fmt(periodStart), fmt(periodEnd)],
          )
        : null;

      result.sales = {
        currentPeriodInvoiced: Number(currentInvoiced.rows[0]?.total ?? 0),
        previousPeriodInvoiced: Number(previousInvoiced.rows[0]?.total ?? 0),
        currentPeriodCollected: Number(currentCollected.rows[0]?.total ?? 0),
        previousPeriodCollected: Number(previousCollected.rows[0]?.total ?? 0),
        creditNotesCurrentPeriod: creditNotesTotal ? Number(creditNotesTotal.rows[0]?.total ?? 0) : null,
        periodStart: fmt(periodStart),
        periodEnd: fmt(periodEnd),
        previousPeriodStart: fmt(previousPeriodStart),
        previousPeriodEnd: fmt(previousPeriodEnd),
      };

      // --- Top-selling products (current month, by revenue) ---
      const topProducts = await this.db.query<{ id: string; name: string; sku: string; quantity: string | number; revenue: string | number }>(
        `SELECT ii.product_id AS id, ii.product_name AS name, ii.sku,
                SUM(ii.quantity) AS quantity, SUM(ii.line_total) AS revenue
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id AND i.company_id = ii.company_id
         WHERE ii.company_id = $1 AND i.currency = $2::text
           AND i.status NOT IN ('draft', 'cancelled')
           AND i.issue_date >= $4::date AND i.issue_date < $5::date
           AND ii.product_id IS NOT NULL
           ${branchFilter}
         GROUP BY ii.product_id, ii.product_name, ii.sku
         ORDER BY revenue DESC
         LIMIT 5`,
        [...salesParams, fmt(periodStart), fmt(periodEnd)],
      );
      result.topProducts = topProducts.rows.map((row) => ({
        id: row.id, name: row.name, sku: row.sku ?? '',
        quantity: Number(row.quantity), revenue: Number(row.revenue),
      }));

      // --- Category breakdown (current month, by revenue) ---
      const categoryBreakdown = await this.db.query<{ category: string; revenue: string | number }>(
        `SELECT COALESCE(p.category, 'Uncategorised') AS category, SUM(ii.line_total) AS revenue
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id AND i.company_id = ii.company_id
         LEFT JOIN products p ON p.id = ii.product_id AND p.company_id = ii.company_id
         WHERE ii.company_id = $1 AND i.currency = $2::text
           AND i.status NOT IN ('draft', 'cancelled')
           AND i.issue_date >= $4::date AND i.issue_date < $5::date
           ${branchFilter}
         GROUP BY COALESCE(p.category, 'Uncategorised')
         ORDER BY revenue DESC
         LIMIT 6`,
        [...salesParams, fmt(periodStart), fmt(periodEnd)],
      );
      result.categoryBreakdown = categoryBreakdown.rows.map((row) => ({
        category: row.category, revenue: Number(row.revenue),
      }));
    }

    // --- Expenses for current and previous calendar month ---
    // Expenses are company-wide financial data — blocked for branch-bound users,
    // consistent with the accounting module's assertCompanyWide guard.
    if (can('accounting', 'expenses:read') && !membership.branchId) {
      const periodStart = new Date();
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      const previousPeriodStart = new Date(periodStart);
      previousPeriodStart.setMonth(previousPeriodStart.getMonth() - 1);
      const previousPeriodEnd = new Date(periodStart);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const currentExpenses = await this.db.query<{ total: string | number }>(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE company_id = $1 AND expense_date >= $2::date AND expense_date < $3::date',
        [membership.companyId, fmt(periodStart), fmt(periodEnd)],
      );
      const previousExpenses = await this.db.query<{ total: string | number }>(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE company_id = $1 AND expense_date >= $2::date AND expense_date < $3::date',
        [membership.companyId, fmt(previousPeriodStart), fmt(previousPeriodEnd)],
      );
      result.expenses = {
        currentPeriod: Number(currentExpenses.rows[0]?.total ?? 0),
        previousPeriod: Number(previousExpenses.rows[0]?.total ?? 0),
        periodStart: fmt(periodStart),
        periodEnd: fmt(periodEnd),
        previousPeriodStart: fmt(previousPeriodStart),
        previousPeriodEnd: fmt(previousPeriodEnd),
      };
    }

    return {
      ...result,
      accessMode: catalogue.accessMode,
      subscription: catalogue.subscription ? { status: catalogue.subscription.status } : null,
      modules: Object.fromEntries(enabled),
    };
  }
}