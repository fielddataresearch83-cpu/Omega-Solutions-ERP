import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service.js';

function makeService(branchId: string | null, options?: { permissions?: string[]; modules?: string[] }) {
  const perms = options?.permissions ?? ['customers:read', 'suppliers:read', 'products:read', 'sales:read'];
  const mods = options?.modules ?? ['sales', 'procurement', 'inventory'];
  const db = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('SELECT currency FROM companies')) return { rows: [{ currency: 'KES' }], rowCount: 1 };
      if (sql.includes('FROM customers WHERE company_id')) return { rows: [{ count: 4, receivables: '1250.50' }], rowCount: 1 };
      if (sql.includes('FROM suppliers WHERE company_id')) return { rows: [{ count: 2, payables: '700.25' }], rowCount: 1 };
      if (sql.includes('COUNT(*) FILTER')) return { rows: [{ active_products: 9, low_stock: 2, cost_value: '15000' }], rowCount: 1 };
      if (sql.includes('SELECT id, name, sku, stock_quantity')) return { rows: [{ id: 'p1', name: 'Soap', sku: 'SOAP-1', stock_quantity: 1, reorder_level: 5 }], rowCount: 1 };
      if (sql.includes('TO_CHAR(DATE_TRUNC')) return { rows: [{ key: '2026-10', total: '5000' }], rowCount: 1 };
      if (sql.includes('GREATEST(i.total - i.amount_paid')) return { rows: [{ id: 'i1', invoice_number: 'INV-1', customer_name: 'Customer A', due_date: '2026-10-01', currency: 'KES', balance: '100' }], rowCount: 1 };
      // New sales revenue queries — detect by SUM(i.total) without TO_CHAR
      if (sql.includes('COALESCE(SUM(i.total)') && !sql.includes('TO_CHAR')) return { rows: [{ total: '8000' }], rowCount: 1 };
      // Collected payments
      if (sql.includes('COALESCE(SUM(ip.amount)')) return { rows: [{ total: '6000' }], rowCount: 1 };
      // Credit notes
      if (sql.includes('COALESCE(SUM(cn.total)')) return { rows: [{ total: '500' }], rowCount: 1 };
      // Top products
      if (sql.includes('ii.product_id AS id')) return { rows: [{ id: 'p1', name: 'Soap', sku: 'SOAP-1', quantity: '50', revenue: '5000' }], rowCount: 1 };
      // Category breakdown
      if (sql.includes("COALESCE(p.category, 'Uncategorised')")) return { rows: [{ category: 'Beverages', revenue: '3000' }], rowCount: 1 };
      // Expenses
      if (sql.includes('COALESCE(SUM(amount)') && sql.includes('FROM expenses')) return { rows: [{ total: '2000' }], rowCount: 1 };
      throw new Error('Unexpected dashboard SQL: ' + sql);
    }),
  };
  const memberships = {
    getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId }),
  };
  const subscriptions = {
    getModuleCatalogue: vi.fn().mockResolvedValue({
      modules: mods.map((code) => ({ code, enabled: true })),
      accessMode: 'subscription',
      subscription: { status: 'active' },
    }),
  };
  const user = {
    userId: 'user-1',
    companyId: 'company-1',
    permissions: perms,
  } as never;
  const service = new DashboardService(db as never, memberships as never, subscriptions as never);
  return { service, db, user };
}

describe('DashboardService.summary', () => {
  it('returns aggregated company metrics and compact lists for company-wide users', async () => {
    const { service, db } = makeService(null);

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['customers:read', 'suppliers:read', 'products:read', 'sales:read'],
    } as never);

    expect(result.customers).toEqual({ count: 4, receivables: 1250.5 });
    expect(result.suppliers).toEqual({ count: 2, payables: 700.25 });
    expect(result.inventory).toMatchObject({ activeProducts: 9, lowStock: 2, costValue: 15000 });
    const inventoryQuery = db.query.mock.calls.find(([sql]) => String(sql).includes('COUNT(*) FILTER'));
    expect(String(inventoryQuery?.[0])).toContain('inventory_stock_levels');
    expect(String(inventoryQuery?.[0])).toContain('s.quantity * s.average_unit_cost');
    expect(String(inventoryQuery?.[0])).not.toContain('SUM(cost_price * stock_quantity)');
    expect(result.invoiceTrend).toEqual([{ key: '2026-10', total: 5000 }]);
    expect(result.overdueInvoices?.[0]).toMatchObject({ invoice_number: 'INV-1', balance: 100 });
    const invoiceQueries = db.query.mock.calls.filter(([sql]) => String(sql).includes('FROM invoices i'));
    expect(invoiceQueries.length).toBeGreaterThanOrEqual(2);
    expect(invoiceQueries.every(([sql]) => String(sql).includes('i.currency = $2::text'))).toBe(true);
  });

  it('does not expose company-wide supplier or customer balances to branch-bound users', async () => {
    const { service, db } = makeService('branch-1');

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['customers:read', 'suppliers:read', 'products:read', 'sales:read'],
    } as never);

    expect(result.customers).toEqual({ count: 4, receivables: null });
    expect(result.suppliers).toBeNull();
    expect(result.inventory).toBeNull();
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('FROM suppliers WHERE company_id'))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('COUNT(*) FILTER'))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('SELECT id, name, sku, stock_quantity'))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('pr.branch_id = $3::uuid'))).toBe(true);
  });

  it('returns sales revenue with current and previous period invoiced amounts', async () => {
    const { service } = makeService(null);

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['sales:read'],
    } as never);

    expect(result.sales).not.toBeNull();
    expect(result.sales!.currentPeriodInvoiced).toBe(8000);
    expect(result.sales!.previousPeriodInvoiced).toBe(8000);
    expect(result.sales!.creditNotesCurrentPeriod).toBe(500);
    expect(result.sales!.periodStart).toMatch(/^\d{4}-\d{2}-01$/);
    expect(result.sales!.previousPeriodStart).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('returns collected payments separately from invoiced sales', async () => {
    const { service } = makeService(null);

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['sales:read'],
    } as never);

    expect(result.sales).not.toBeNull();
    expect(result.sales!.currentPeriodCollected).toBe(6000);
    expect(result.sales!.previousPeriodCollected).toBe(6000);
    // Invoiced and collected are distinct figures
    expect(result.sales!.currentPeriodInvoiced).not.toBe(result.sales!.currentPeriodCollected);
  });

  it('returns top-selling products for the current period', async () => {
    const { service } = makeService(null);

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['sales:read'],
    } as never);

    expect(result.topProducts).not.toBeNull();
    expect(result.topProducts).toHaveLength(1);
    expect(result.topProducts![0]).toEqual({ id: 'p1', name: 'Soap', sku: 'SOAP-1', quantity: 50, revenue: 5000 });
  });

  it('returns category breakdown for the current period', async () => {
    const { service } = makeService(null);

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['sales:read'],
    } as never);

    expect(result.categoryBreakdown).not.toBeNull();
    expect(result.categoryBreakdown).toHaveLength(1);
    expect(result.categoryBreakdown![0]).toEqual({ category: 'Beverages', revenue: 3000 });
  });

  it('excludes sales, top products and category breakdown when sales:read permission is missing', async () => {
    const { service } = makeService(null, { permissions: ['customers:read'], modules: ['sales'] });

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['customers:read'],
    } as never);

    expect(result.sales).toBeNull();
    expect(result.topProducts).toBeNull();
    expect(result.categoryBreakdown).toBeNull();
    expect(result.invoiceTrend).toBeNull();
    expect(result.overdueInvoices).toBeNull();
  });

  it('returns expenses when accounting module and expenses:read are enabled', async () => {
    const { service } = makeService(null, {
      permissions: ['expenses:read'],
      modules: ['accounting'],
    });

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['expenses:read'],
    } as never);

    expect(result.expenses).not.toBeNull();
    expect(result.expenses!.currentPeriod).toBe(2000);
    expect(result.expenses!.previousPeriod).toBe(2000);
    expect(result.expenses!.periodStart).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('blocks expenses for branch-bound users even with expenses:read permission', async () => {
    const { service } = makeService('branch-1', {
      permissions: ['expenses:read'],
      modules: ['accounting'],
    });

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['expenses:read'],
    } as never);

    expect(result.expenses).toBeNull();
  });

  it('does not return expenses when accounting module is not enabled', async () => {
    const { service } = makeService(null, {
      permissions: ['expenses:read'],
      modules: ['sales'],
    });

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['expenses:read'],
    } as never);

    expect(result.expenses).toBeNull();
  });

  it('applies branch filter to sales revenue, top products and category queries', async () => {
    const { service, db } = makeService('branch-1', {
      permissions: ['sales:read'],
      modules: ['sales'],
    });

    await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['sales:read'],
    } as never);

    const salesQueries = db.query.mock.calls.filter(([sql]) =>
      String(sql).includes('COALESCE(SUM(i.total)') && !String(sql).includes('TO_CHAR'),
    );
    expect(salesQueries.length).toBeGreaterThanOrEqual(2);
    expect(salesQueries.every(([sql]) => String(sql).includes('pr.branch_id = $3::uuid'))).toBe(true);

    const topProductQueries = db.query.mock.calls.filter(([sql]) => String(sql).includes('ii.product_id AS id'));
    expect(topProductQueries).toHaveLength(1);
    expect(String(topProductQueries[0]?.[0])).toContain('pr.branch_id = $3::uuid');

    const categoryQueries = db.query.mock.calls.filter(([sql]) => String(sql).includes("COALESCE(p.category, 'Uncategorised')"));
    expect(categoryQueries).toHaveLength(1);
    expect(String(categoryQueries[0]?.[0])).toContain('pr.branch_id = $3::uuid');
  });

  it('excludes draft and cancelled invoices from all sales queries', async () => {
    const { service, db } = makeService(null, {
      permissions: ['sales:read'],
      modules: ['sales'],
    });

    await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['sales:read'],
    } as never);

    const allInvoiceQueries = db.query.mock.calls
      .filter(([sql]) => String(sql).includes('FROM invoices i') && !String(sql).includes('invoice_payments'))
      .map(([sql]) => String(sql));

    for (const sql of allInvoiceQueries) {
      // Every direct invoice query must exclude draft and cancelled.
      // The overdue query additionally excludes paid — that's correct, not a defect.
      expect(sql).toMatch(/status NOT IN \('draft', 'cancelled'(?:, 'paid')?\)/);
    }

    // Collected payments query uses ip.status IN ('confirmed','reconciled') instead,
    // which is the correct way to identify collected payments.
    const paymentQueries = db.query.mock.calls
      .filter(([sql]) => String(sql).includes('invoice_payments'))
      .map(([sql]) => String(sql));
    expect(paymentQueries.length).toBeGreaterThanOrEqual(2);
    for (const sql of paymentQueries) {
      expect(sql).toContain("ip.status IN ('confirmed', 'reconciled')");
    }
  });

  it('returns empty arrays for top products and category breakdown when no sales exist', async () => {
    const db = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('SELECT currency FROM companies')) return { rows: [{ currency: 'KES' }], rowCount: 1 };
        if (sql.includes('COALESCE(SUM(i.total)') && !sql.includes('TO_CHAR')) return { rows: [{ total: '0' }], rowCount: 1 };
        if (sql.includes('COALESCE(SUM(ip.amount)')) return { rows: [{ total: '0' }], rowCount: 1 };
        if (sql.includes('COALESCE(SUM(cn.total)')) return { rows: [{ total: '0' }], rowCount: 1 };
        if (sql.includes('TO_CHAR(DATE_TRUNC')) return { rows: [], rowCount: 0 };
        if (sql.includes('GREATEST(i.total - i.amount_paid')) return { rows: [], rowCount: 0 };
        if (sql.includes('ii.product_id AS id')) return { rows: [], rowCount: 0 };
        if (sql.includes("COALESCE(p.category, 'Uncategorised')")) return { rows: [], rowCount: 0 };
        throw new Error('Unexpected dashboard SQL: ' + sql);
      }),
    };
    const memberships = {
      getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId: null }),
    };
    const subscriptions = {
      getModuleCatalogue: vi.fn().mockResolvedValue({
        modules: [{ code: 'sales', enabled: true }],
        accessMode: 'subscription',
        subscription: { status: 'active' },
      }),
    };
    const service = new DashboardService(db as never, memberships as never, subscriptions as never);

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['sales:read'],
    } as never);

    expect(result.sales!.currentPeriodInvoiced).toBe(0);
    expect(result.topProducts).toEqual([]);
    expect(result.categoryBreakdown).toEqual([]);
    expect(result.invoiceTrend).toEqual([]);
    expect(result.overdueInvoices).toEqual([]);
  });

  it('suppresses credit notes for branch-bound users to avoid leaking company-wide totals', async () => {
    const { service, db } = makeService('branch-1', {
      permissions: ['sales:read'],
      modules: ['sales'],
    });

    const result = await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['sales:read'],
    } as never);

    expect(result.sales).not.toBeNull();
    expect(result.sales!.creditNotesCurrentPeriod).toBeNull();
    // Credit notes query must not be executed for branch users
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('COALESCE(SUM(cn.total)'))).toBe(false);
  });

  it('scopes all queries to the authenticated company id, never trusting a frontend-supplied id', async () => {
    const { service, db } = makeService(null, {
      permissions: ['sales:read', 'expenses:read'],
      modules: ['sales', 'accounting'],
    });

    await service.summary({
      userId: 'user-1',
      companyId: 'company-1',
      permissions: ['sales:read', 'expenses:read'],
    } as never);

    const allParams = db.query.mock.calls.map((call) => call[1] as unknown[]);
    for (const params of allParams) {
      expect(params[0]).toBe('company-1');
    }
  });
});
