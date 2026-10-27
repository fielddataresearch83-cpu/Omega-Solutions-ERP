import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service.js';

function makeService(branchId: string | null) {
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT currency FROM companies')) return { rows: [{ currency: 'KES' }], rowCount: 1 };
      if (sql.includes('FROM customers WHERE company_id')) return { rows: [{ count: 4, receivables: '1250.50' }], rowCount: 1 };
      if (sql.includes('FROM suppliers WHERE company_id')) return { rows: [{ count: 2, payables: '700.25' }], rowCount: 1 };
      if (sql.includes('COUNT(*) FILTER')) return { rows: [{ active_products: 9, low_stock: 2, cost_value: '15000' }], rowCount: 1 };
      if (sql.includes('SELECT id, name, sku, stock_quantity')) return { rows: [{ id: 'p1', name: 'Soap', sku: 'SOAP-1', stock_quantity: 1, reorder_level: 5 }], rowCount: 1 };
      if (sql.includes('TO_CHAR(DATE_TRUNC')) return { rows: [{ key: '2026-10', total: '5000' }], rowCount: 1 };
      if (sql.includes('GREATEST(i.total - i.amount_paid')) return { rows: [{ id: 'i1', invoice_number: 'INV-1', customer_name: 'Customer A', due_date: '2026-10-01', currency: 'KES', balance: '100' }], rowCount: 1 };
      throw new Error('Unexpected dashboard SQL: ' + sql);
    }),
  };
  const memberships = {
    getMembershipForCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', branchId }),
  };
  const subscriptions = {
    getModuleCatalogue: vi.fn().mockResolvedValue({
      modules: [
        { code: 'sales', enabled: true },
        { code: 'procurement', enabled: true },
        { code: 'inventory', enabled: true },
      ],
    }),
  };
  const service = new DashboardService(db as never, memberships as never, subscriptions as never);
  return { service, db };
}

const user = {
  userId: 'user-1',
  companyId: 'company-1',
  permissions: ['customers:read', 'suppliers:read', 'products:read', 'sales:read'],
} as never;

describe('DashboardService.summary', () => {
  it('returns aggregated company metrics and compact lists for company-wide users', async () => {
    const { service } = makeService(null);

    const result = await service.summary(user);

    expect(result.customers).toEqual({ count: 4, receivables: 1250.5 });
    expect(result.suppliers).toEqual({ count: 2, payables: 700.25 });
    expect(result.inventory).toMatchObject({ activeProducts: 9, lowStock: 2, costValue: 15000 });
    expect(result.invoiceTrend).toEqual([{ key: '2026-10', total: 5000 }]);
    expect(result.overdueInvoices?.[0]).toMatchObject({ invoice_number: 'INV-1', balance: 100 });
    const invoiceQueries = db.query.mock.calls.filter(([sql]) => String(sql).includes('FROM invoices i'));
    expect(invoiceQueries).toHaveLength(2);
    expect(invoiceQueries.every(([sql]) => String(sql).includes('i.currency = $2::text'))).toBe(true);
  });

  it('does not expose company-wide supplier or customer balances to branch-bound users', async () => {
    const { service, db } = makeService('branch-1');

    const result = await service.summary(user);

    expect(result.customers).toEqual({ count: 4, receivables: null });
    expect(result.suppliers).toBeNull();
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('FROM suppliers WHERE company_id'))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('pr.branch_id = $3::uuid'))).toBe(true);
  });
});
